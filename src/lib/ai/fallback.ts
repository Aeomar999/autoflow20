import "server-only";
import type { LanguageModel } from "ai";
import { NonRetriableError } from "inngest";
import type { CredentialSecret } from "@/features/credentials/server/vault";
import { logger } from "@/lib/logger";
import { readAiCache, writeAiCache } from "./cache";
import { createLanguageModel } from "./provider";
import {
  AI_PROVIDERS,
  type AiModelDef,
  type AiProviderId,
  aiModelId,
  aiProviderById,
  estimateRunCostUsd,
  resolveAiModel,
} from "./registry";

/** Splits "provider:model" into its legs; a bare token is just a provider. */
export function splitModelId(raw: string | undefined): {
  provider: string;
  modelHint: string | undefined;
} {
  if (!raw || raw.length === 0) {
    return { provider: "", modelHint: undefined };
  }
  const colon = raw.indexOf(":");
  if (colon === -1) {
    return { provider: raw.trim(), modelHint: undefined };
  }
  return {
    provider: raw.slice(0, colon).trim(),
    modelHint: raw.slice(colon + 1).trim() || undefined,
  };
}

/**
 * Parses primary model and optional fallback string into an ordered,
 * deduplicated list of candidate model strings.
 */
export function parseModelChain(
  primary?: string,
  fallbackString?: string,
): string[] {
  const candidates: string[] = [];
  if (primary && primary.trim().length > 0) {
    candidates.push(primary.trim());
  }
  if (fallbackString && fallbackString.trim().length > 0) {
    const parts = fallbackString
      .split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const part of parts) {
      if (!candidates.includes(part)) {
        candidates.push(part);
      }
    }
  }
  if (candidates.length === 0) {
    candidates.push("openai");
  }
  return candidates;
}

export interface CandidateContext {
  candidateString: string;
  provider: string;
  providerDef: NonNullable<ReturnType<typeof aiProviderById.get>>;
  modelDef: AiModelDef;
  fullModelId: string;
  apiKey: string | undefined;
  languageModel: LanguageModel;
}

export interface FallbackRunResult<T> {
  value: T;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    promptTokens?: number;
    completionTokens?: number;
  };
}

export interface FallbackAttempt {
  model: string;
  error: string;
}

export interface FallbackExecutionResult<T> {
  result: T;
  servedModel: string;
  attempts: FallbackAttempt[];
  usage: {
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
    model: string;
    /**
     * Response-cache outcome (AF-M5-07): true = served from cache, false =
     * cache configured but missed, null = no cache configured on this call.
     */
    cacheHit: boolean | null;
  };
}

/**
 * Opt-in response caching for this call (AF-M5-07). Absent, or a
 * non-positive TTL, means every run goes to the provider.
 */
export interface FallbackCacheOptions {
  /** Tenant that owns the entry. Absent when a run has no workspace context. */
  organizationId?: string;
  nodeType: string;
  /** Fingerprint from `buildAiCacheKey` over the compiled request. */
  cacheKey: string;
  ttlSeconds: number;
}

/**
 * Resolves a candidate model string to its provider, model def, credentials, and LanguageModel.
 */
export function resolveCandidate(
  candidateString: string,
  credentials?: Record<string, CredentialSecret | undefined>,
): CandidateContext {
  const { provider, modelHint } = splitModelId(candidateString);
  const providerDef = aiProviderById.get(provider as AiProviderId);
  if (!providerDef) {
    throw new NonRetriableError(
      `unknown provider "${provider || "<unset>"}". Configure a model like "openai:gpt-4o". Providers: ${AI_PROVIDERS.join(", ")}`,
    );
  }

  let modelDef: AiModelDef;
  try {
    modelDef = resolveAiModel(providerDef.id, modelHint);
  } catch (error) {
    throw new NonRetriableError(
      error instanceof Error ? error.message : "unknown model",
    );
  }
  const fullModelId = aiModelId(modelDef.provider, modelDef.model);

  const secret =
    modelDef.adapter === "anthropic"
      ? credentials?.anthropicCredentialId
      : modelDef.adapter === "google"
        ? credentials?.geminiCredentialId
        : credentials?.openaiCredentialId;
  const apiKey = secret?.apiKey ?? secret?.accessToken;

  if (providerDef.requiresKey && !apiKey) {
    throw new NonRetriableError(
      `credential required for provider "${providerDef.id}" (${providerDef.credentialType ?? "api key"}), but none is configured on the node`,
    );
  }

  const languageModel = createLanguageModel({
    adapter: modelDef.adapter,
    modelId: modelDef.model,
    apiKey,
    baseUrl: providerDef.baseUrl,
  });

  return {
    candidateString,
    provider,
    providerDef,
    modelDef,
    fullModelId,
    apiKey,
    languageModel,
  };
}

/**
 * Executes a function with fallback support across model candidates.
 *
 * With `cache` configured and a positive TTL, a live entry for this workspace
 * short-circuits the whole chain: no provider is called, and the reported
 * usage is zero tokens / zero dollars because nothing was purchased.
 */
export async function executeWithFallback<T>(
  candidates: string[],
  credentials: Record<string, CredentialSecret | undefined> | undefined,
  nodeName: string,
  runFn: (candidate: CandidateContext) => Promise<T | FallbackRunResult<T>>,
  cache?: FallbackCacheOptions,
): Promise<FallbackExecutionResult<T>> {
  const attempts: FallbackAttempt[] = [];
  const cacheEnabled = Boolean(
    cache && cache.ttlSeconds > 0 && cache.organizationId,
  );

  if (cache && cacheEnabled) {
    const hit = await readAiCache({
      organizationId: cache.organizationId as string,
      cacheKey: cache.cacheKey,
    });
    if (hit) {
      return {
        result: hit.value as T,
        servedModel: hit.model,
        attempts,
        usage: {
          tokensIn: 0,
          tokensOut: 0,
          costUsd: 0,
          model: hit.model,
          cacheHit: true,
        },
      };
    }
  }

  for (const candidate of candidates) {
    let resolved: CandidateContext;
    try {
      resolved = resolveCandidate(candidate, credentials);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      if (candidates.length === 1) {
        throw new NonRetriableError(`${nodeName}: ${errorMsg}`);
      }
      attempts.push({ model: candidate, error: errorMsg });
      continue;
    }

    try {
      const rawResult = await runFn(resolved);
      const isRunResultObj = (val: unknown): val is FallbackRunResult<T> =>
        typeof val === "object" && val !== null && "value" in val;

      const finalValue = isRunResultObj(rawResult)
        ? rawResult.value
        : (rawResult as T);
      const rawUsage = isRunResultObj(rawResult) ? rawResult.usage : undefined;

      const tokensIn = Math.max(
        0,
        Math.round(rawUsage?.inputTokens ?? rawUsage?.promptTokens ?? 0),
      );
      const tokensOut = Math.max(
        0,
        Math.round(rawUsage?.outputTokens ?? rawUsage?.completionTokens ?? 0),
      );

      let costUsd = 0;
      try {
        costUsd = estimateRunCostUsd(resolved.fullModelId, {
          inputTokens: tokensIn,
          outputTokens: tokensOut,
        });
      } catch (error) {
        // Ignorable: an unpriced model still ran and produced an answer. Cost
        // is reported as 0 rather than blocking the result, but the gap is
        // logged so a missing registry price is visible instead of silent.
        logger.warn("no registry price for model; reporting zero cost", {
          error,
          model: resolved.fullModelId,
          node: nodeName,
        });
        costUsd = 0;
      }

      if (cache && cacheEnabled) {
        await writeAiCache({
          organizationId: cache.organizationId as string,
          cacheKey: cache.cacheKey,
          nodeType: cache.nodeType,
          model: resolved.fullModelId,
          value: finalValue,
          tokensIn,
          tokensOut,
          costUsd,
          ttlSeconds: cache.ttlSeconds,
        });
      }

      return {
        result: finalValue,
        servedModel: resolved.fullModelId,
        attempts,
        usage: {
          tokensIn,
          tokensOut,
          costUsd,
          model: resolved.fullModelId,
          cacheHit: cacheEnabled ? false : null,
        },
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      if (candidates.length === 1) {
        throw err instanceof NonRetriableError
          ? err
          : new NonRetriableError(`${nodeName}: ${errorMsg}`);
      }
      attempts.push({ model: resolved.fullModelId, error: errorMsg });
    }
  }

  // All candidates failed
  const failureSummary = attempts
    .map((a) => `[${a.model}]: ${a.error}`)
    .join("; ");
  throw new NonRetriableError(
    `${nodeName}: all candidate models in fallback chain failed: ${failureSummary}`,
  );
}
