/**
 * AI provider registry (AF-M5-01) — all model metadata is data, not code.
 * Isomorphic + pure: safe for the editor (cost estimates, model pickers) and
 * the server (credential type selection, pre-run validation).
 *
 * Every model is keyed `provider:model`. Malformed data, unknown adapters,
 * and provider/credential drift fail at module load — a bad entry can never
 * silently reach a runner.
 *
 * Spec: docs/architecture/overview.md §5.4. ADR: docs/decisions/0009.
 */

import { credentialDefsById } from "@/features/credentials/credential-types";

export const AI_ADAPTERS = ["openai", "anthropic", "google"] as const;
export type AiAdapter = (typeof AI_ADAPTERS)[number];

export const AI_PROVIDERS = [
  "openai",
  "anthropic",
  "google",
  "groq",
  "deepseek",
  "ollama",
] as const;
export type AiProviderId = (typeof AI_PROVIDERS)[number];

export const AI_CAPABILITIES = [
  "chat",
  "audio",
  "json",
  "reasoning",
  "toolUse",
  "vision",
] as const;
export type AiCapability = (typeof AI_CAPABILITIES)[number];

export interface AiProviderDef {
  id: AiProviderId;
  label: string;
  /** Credential registry type holding this provider's key (keyed providers only). */
  credentialType?: string;
  /** False for local providers (ollama); true otherwise. */
  requiresKey: boolean;
  /** Fixed base URL for OpenAI-compatible providers; absent for native adapters. */
  baseUrl?: string;
  /** Model id (without the provider prefix) used when a caller omits one. */
  defaultModel: string;
}

export interface AiModelDef {
  provider: AiProviderId;
  model: string;
  adapter: AiAdapter;
  /** Approximate context window in tokens. */
  contextWindow: number;
  capabilities: AiCapability[];
  /** USD per 1M input tokens. 0 for local models. */
  inputCostPer1M: number;
  /** USD per 1M output tokens. 0 for local models. */
  outputCostPer1M: number;
}

export class UnknownAiModelError extends Error {
  constructor(model: string, known: string[]) {
    super(
      `Unknown AI model: "${model}". Registered models: ${known.join(", ")}`,
    );
    this.name = "UnknownAiModelError";
  }
}

export const aiProviderDefs: AiProviderDef[] = [
  {
    id: "openai",
    label: "OpenAI",
    credentialType: "openai.apiKey",
    requiresKey: true,
    defaultModel: "gpt-4o-mini",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    credentialType: "anthropic.apiKey",
    requiresKey: true,
    defaultModel: "claude-3-5-sonnet",
  },
  {
    id: "google",
    label: "Google Gemini",
    credentialType: "gemini.apiKey",
    requiresKey: true,
    defaultModel: "gemini-3.6-flash",
  },
  {
    id: "groq",
    label: "Groq",
    credentialType: "groq.apiKey",
    requiresKey: true,
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "openai/gpt-oss-120b",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    credentialType: "deepseek.apiKey",
    requiresKey: true,
    baseUrl: "https://api.deepseek.com",
    defaultModel: "deepseek-chat",
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    requiresKey: false,
    baseUrl: "http://localhost:11434/v1",
    defaultModel: "mistral",
  },
];

export const aiModelDefs: AiModelDef[] = [
  // OpenAI
  {
    provider: "openai",
    model: "gpt-4o-mini",
    adapter: "openai",
    contextWindow: 128_000,
    capabilities: ["chat", "json", "vision", "toolUse"],
    inputCostPer1M: 0.15,
    outputCostPer1M: 0.6,
  },
  {
    provider: "openai",
    model: "gpt-4o",
    adapter: "openai",
    contextWindow: 128_000,
    capabilities: ["chat", "json", "vision", "toolUse", "audio"],
    inputCostPer1M: 2.5,
    outputCostPer1M: 10,
  },
  // Anthropic
  {
    provider: "anthropic",
    model: "claude-3-5-haiku",
    adapter: "anthropic",
    contextWindow: 200_000,
    capabilities: ["chat", "json", "toolUse"],
    inputCostPer1M: 0.8,
    outputCostPer1M: 4,
  },
  {
    provider: "anthropic",
    model: "claude-3-5-sonnet",
    adapter: "anthropic",
    contextWindow: 200_000,
    capabilities: ["chat", "json", "vision", "toolUse"],
    inputCostPer1M: 3,
    outputCostPer1M: 15,
  },
  // Google
  //
  // The 1.5 line was removed 2026-09-05: Google no longer serves it, and a
  // request for it comes back "models/gemini-1.5-flash is not found for API
  // version v1beta" — which reached a user as a failed run, not as a
  // deprecation notice. Ids here are the stable ones the Generative Language
  // ListModels endpoint reports as supporting generateContent.
  // 2.5 went the same way as 1.5 while this was being written: listed by
  // ListModels, but refused with "no longer available to new users. Please
  // update your code to use models/gemini-3.6-flash". The ids below were each
  // confirmed with a live one-token generation rather than read off a page.
  {
    provider: "google",
    model: "gemini-3.6-flash",
    adapter: "google",
    contextWindow: 1_048_576,
    capabilities: ["chat", "json", "vision", "audio", "toolUse"],
    inputCostPer1M: 0.3,
    outputCostPer1M: 2.5,
  },
  {
    provider: "google",
    model: "gemini-3.8-flash",
    adapter: "google",
    contextWindow: 1_048_576,
    capabilities: ["chat", "json", "vision", "audio", "toolUse"],
    inputCostPer1M: 0.3,
    outputCostPer1M: 2.5,
  },
  {
    // Alias Google keeps pointed at the current flash. Useful as a fallback
    // precisely because it does not rot the way a pinned id does.
    provider: "google",
    model: "gemini-flash-latest",
    adapter: "google",
    contextWindow: 1_048_576,
    capabilities: ["chat", "json", "vision", "audio", "toolUse"],
    inputCostPer1M: 0.3,
    outputCostPer1M: 2.5,
  },
  {
    // The pro tier needs billing enabled; a free-tier key gets a quota refusal
    // rather than a missing-model error, which is a different fix.
    provider: "google",
    model: "gemini-pro-latest",
    adapter: "google",
    contextWindow: 1_048_576,
    capabilities: ["chat", "json", "vision", "audio", "toolUse"],
    inputCostPer1M: 1.25,
    outputCostPer1M: 10,
  },
  // Groq (OpenAI-compatible)
  //
  // Retired alongside the Gemini 1.5 line: Groq answers "The model
  // `llama-3.3-70b-versatile` does not exist or you do not have access to it".
  {
    provider: "groq",
    model: "openai/gpt-oss-120b",
    adapter: "openai",
    contextWindow: 131_072,
    capabilities: ["chat", "json", "toolUse"],
    inputCostPer1M: 0.15,
    outputCostPer1M: 0.75,
  },
  {
    provider: "groq",
    model: "openai/gpt-oss-20b",
    adapter: "openai",
    contextWindow: 131_072,
    capabilities: ["chat", "json", "toolUse"],
    inputCostPer1M: 0.05,
    outputCostPer1M: 0.08,
  },
  // DeepSeek (OpenAI-compatible)
  {
    provider: "deepseek",
    model: "deepseek-chat",
    adapter: "openai",
    contextWindow: 65_536,
    capabilities: ["chat", "json", "toolUse"],
    inputCostPer1M: 0.27,
    outputCostPer1M: 1.1,
  },
  {
    provider: "deepseek",
    model: "deepseek-reasoner",
    adapter: "openai",
    contextWindow: 65_536,
    capabilities: ["chat", "json", "reasoning", "toolUse"],
    inputCostPer1M: 0.55,
    outputCostPer1M: 2.19,
  },
  // Ollama (local, free, keyless)
  {
    provider: "ollama",
    model: "llama3.2",
    adapter: "openai",
    contextWindow: 131_072,
    capabilities: ["chat", "toolUse"],
    inputCostPer1M: 0,
    outputCostPer1M: 0,
  },
  {
    provider: "ollama",
    model: "mistral",
    adapter: "openai",
    contextWindow: 131_072,
    capabilities: ["chat", "toolUse"],
    inputCostPer1M: 0,
    outputCostPer1M: 0,
  },
];

function validateAiRegistry(): void {
  const providerById = new Map<string, AiProviderDef>();
  for (const provider of aiProviderDefs) {
    if (!AI_PROVIDERS.includes(provider.id)) {
      throw new Error(`AI registry: unknown provider "${provider.id}"`);
    }
    if (providerById.has(provider.id)) {
      throw new Error(`AI registry: duplicate provider "${provider.id}"`);
    }
    providerById.set(provider.id, provider);

    if (provider.requiresKey) {
      if (!provider.credentialType) {
        throw new Error(
          `AI registry: provider "${provider.id}" requires a key but declares no credentialType`,
        );
      }
      if (!credentialDefsById.has(provider.credentialType)) {
        throw new Error(
          `AI registry: provider "${provider.id}" references unregistered credential type "${provider.credentialType}"`,
        );
      }
    } else if (provider.credentialType !== undefined) {
      throw new Error(
        `AI registry: keyless provider "${provider.id}" must not declare a credentialType`,
      );
    }
  }

  const modelIds = new Set<string>();
  for (const def of aiModelDefs) {
    const id = aiModelId(def.provider, def.model);
    if (modelIds.has(id)) {
      throw new Error(`AI registry: duplicate model id "${id}"`);
    }
    modelIds.add(id);

    const provider = providerById.get(def.provider);
    if (!provider) {
      throw new Error(
        `AI registry: model "${id}" references unknown provider "${def.provider}"`,
      );
    }
    if (!AI_ADAPTERS.includes(def.adapter)) {
      throw new Error(
        `AI registry: model "${id}" has invalid adapter "${def.adapter}"`,
      );
    }
    if (!Number.isFinite(def.contextWindow) || def.contextWindow <= 0) {
      throw new Error(`AI registry: model "${id}" has invalid contextWindow`);
    }
    if (!Number.isFinite(def.inputCostPer1M) || def.inputCostPer1M < 0) {
      throw new Error(`AI registry: model "${id}" has invalid inputCostPer1M`);
    }
    if (!Number.isFinite(def.outputCostPer1M) || def.outputCostPer1M < 0) {
      throw new Error(`AI registry: model "${id}" has invalid outputCostPer1M`);
    }
    if (!Array.isArray(def.capabilities) || def.capabilities.length === 0) {
      throw new Error(`AI registry: model "${id}" has no capabilities`);
    }
    for (const capability of def.capabilities) {
      if (!AI_CAPABILITIES.includes(capability)) {
        throw new Error(
          `AI registry: model "${id}" has invalid capability "${capability}"`,
        );
      }
    }
  }

  for (const provider of aiProviderDefs) {
    if (!modelIds.has(aiModelId(provider.id, provider.defaultModel))) {
      throw new Error(
        `AI registry: provider "${provider.id}" default model "${provider.defaultModel}" is not registered`,
      );
    }
  }
}

validateAiRegistry();

export const aiProviderById: ReadonlyMap<AiProviderId, AiProviderDef> = new Map(
  aiProviderDefs.map((def) => [def.id, def]),
);

export const aiModelsById: ReadonlyMap<string, AiModelDef> = new Map(
  aiModelDefs.map((def) => [aiModelId(def.provider, def.model), def]),
);

/** Canonical fully-qualified id — always `provider:model`. */
export function aiModelId(provider: AiProviderId, model: string): string {
  return `${provider}:${model}`;
}

export function findAiModel(id: string): AiModelDef | undefined {
  return aiModelsById.get(id);
}

export function listAiModels(provider?: AiProviderId): AiModelDef[] {
  if (provider === undefined) {
    return [...aiModelDefs];
  }
  return aiModelDefs.filter((def) => def.provider === provider);
}

export function defaultAiModelId(provider: AiProviderId): string {
  const providerDef = aiProviderById.get(provider);
  if (!providerDef) {
    throw new UnknownAiModelError(provider, [...aiModelsById.keys()]);
  }
  return aiModelId(provider, providerDef.defaultModel);
}

/**
 * Resolve a model: exact `provider:model` wins, else the provider's default
 * (docs/architecture/overview.md §5.4, AF-M5-04). Deviation from the spec's
 * "first provider's default" leg: with every provider's default guaranteed
 * registered by `validateAiRegistry`, that leg could only fire for an
 * unregistered provider — silently resolving it to another provider's model
 * would be a silent wrong path for the runner, so it throws instead
 * (ADR 0009).
 */
export function resolveAiModel(
  provider: AiProviderId,
  model?: string,
): AiModelDef {
  if (model !== undefined) {
    const exact = findAiModel(aiModelId(provider, model));
    if (exact !== undefined) {
      return exact;
    }
  }
  const providerDef = aiProviderById.get(provider);
  if (providerDef === undefined) {
    throw new UnknownAiModelError(aiModelId(provider, model ?? ""), [
      ...aiModelsById.keys(),
    ]);
  }
  const fallback = findAiModel(aiModelId(provider, providerDef.defaultModel));
  if (fallback === undefined) {
    throw new UnknownAiModelError(aiModelId(provider, model ?? ""), [
      ...aiModelsById.keys(),
    ]);
  }
  return fallback;
}

export interface AiRunUsage {
  inputTokens: number;
  outputTokens: number;
}

/** Round to micro-dollar precision — fractions of a USD cent are noise. */
const roundUsd = (usd: number): number => Math.round(usd * 1e6) / 1e6;

/**
 * Pre-run cost ceiling from per-1M pricing data. The source of truth for
 * editor estimates (AF-M5-06) and run-time capture; the engine records actuals.
 */
export function estimateRunCostUsd(modelId: string, usage: AiRunUsage): number {
  const def = findAiModel(modelId);
  if (def === undefined) {
    throw new UnknownAiModelError(modelId, [...aiModelsById.keys()]);
  }
  const usd =
    (Math.max(0, usage.inputTokens) / 1_000_000) * def.inputCostPer1M +
    (Math.max(0, usage.outputTokens) / 1_000_000) * def.outputCostPer1M;
  return roundUsd(usd);
}

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
 * The model a `provider:model` candidate names, or undefined when it names
 * nothing registered (AF-M10-07).
 *
 * Lives here rather than in `fallback.ts` because the save-time validator runs
 * on the client too, and `fallback.ts` is server-only — it builds language
 * models and reads credentials. Answering "can this model see?" needs neither.
 */
export function findModelForCandidate(
  candidate: string,
): AiModelDef | undefined {
  const { provider, modelHint } = splitModelId(candidate);
  const providerDef = aiProviderById.get(provider as AiProviderId);
  if (!providerDef) {
    return undefined;
  }
  try {
    return resolveAiModel(providerDef.id, modelHint);
  } catch {
    return undefined;
  }
}

/**
 * Rough input-token cost of an attachment (AF-M10-07).
 *
 * Lives beside the rest of the cost math, and in a client-safe module, because
 * the canvas estimator needs it and cannot import the server-only attachment
 * resolver.
 *
 * Providers price images by tile count, which depends on dimensions this code
 * does not decode. Bytes are the one signal available before the call, and the
 * ratio below is calibrated against OpenAI's published high-detail tiling for
 * typical photographic PNG/JPEG. It is an estimate; the RECORDED cost still
 * comes from the provider's own usage numbers.
 */
export const ATTACHMENT_TOKENS_PER_KB = 12;

export function estimateAttachmentTokens(totalBytes: number): number {
  if (totalBytes <= 0) return 0;
  return Math.ceil((totalBytes / 1024) * ATTACHMENT_TOKENS_PER_KB);
}

// ---------------------------------------------------------------------------
// Media generation pricing (AF-M10-23)
// ---------------------------------------------------------------------------

/**
 * Image and video generation is priced **per unit**, not per token, so it
 * cannot live in `AiModelDef` — `inputCostPer1M` has no meaning for a model
 * that charges 4 cents an image.
 *
 * It belongs in this file all the same: the cost pipeline
 * (`__usage.costUsd` → `NodeExecution.costUsd`) is the same one, the editor's
 * estimator reads from here, and a workflow that renders a video and then
 * summarises it should show one bill rather than two systems' worth.
 */
export const MEDIA_UNITS = ["image", "second"] as const;
export type MediaUnit = (typeof MEDIA_UNITS)[number];

export interface AiMediaModelDef {
  /** `provider:model`, matching the AI registry's key shape. */
  id: string;
  label: string;
  kind: "image" | "video";
  /** What one unit of `costPerUnitUsd` buys. */
  unit: MediaUnit;
  /** USD per unit. 0 for genuinely free endpoints. */
  costPerUnitUsd: number;
  /** Credential registry type, absent for keyless providers. */
  credentialType?: string;
}

/**
 * Published list prices at the time of writing. They drift, and that is
 * expected: this is a cost ESTIMATE surfaced in the trace and the editor, not
 * a billing record. A provider that returns its own cost should be preferred
 * over this — none of these four do.
 */
export const aiMediaModels: AiMediaModelDef[] = [
  {
    id: "openai:gpt-image-1",
    label: "OpenAI gpt-image-1",
    kind: "image",
    unit: "image",
    // 1024×1024, standard quality. Higher quality and larger sizes cost more;
    // the node passes the size through so this is the floor, not the ceiling.
    costPerUnitUsd: 0.04,
    credentialType: "openai.apiKey",
  },
  {
    id: "openai:dall-e-3",
    label: "OpenAI DALL·E 3",
    kind: "image",
    unit: "image",
    costPerUnitUsd: 0.04,
    credentialType: "openai.apiKey",
  },
  {
    id: "pollinations:flux",
    label: "Pollinations (Flux)",
    kind: "image",
    unit: "image",
    // Genuinely free and keyless, which is why it is the one media node a
    // credential-free template can use.
    costPerUnitUsd: 0,
  },
  {
    id: "google:veo-3",
    label: "Google Veo 3",
    kind: "video",
    unit: "second",
    costPerUnitUsd: 0.5,
    credentialType: "google.oauth2",
  },
  {
    id: "creatomate:render",
    label: "Creatomate render",
    kind: "video",
    unit: "second",
    // Creatomate meters credits rather than seconds; this is the approximate
    // conversion at its published rate, and the node records the render's own
    // reported duration so the estimate tracks reality.
    costPerUnitUsd: 0.01,
    credentialType: "creatomate.apiKey",
  },
];

const mediaModelsById = new Map(aiMediaModels.map((def) => [def.id, def]));

export function findMediaModel(id: string): AiMediaModelDef | undefined {
  return mediaModelsById.get(id);
}

/**
 * Cost of a generation, for the same `__usage.costUsd` the AI nodes report.
 *
 * An unknown model costs 0 rather than throwing: a media node whose pricing
 * has not been added yet should still run and still record its output. A
 * missing price is a reporting gap; refusing the run would be a worse one.
 */
export function estimateMediaCostUsd(id: string, units: number): number {
  const def = mediaModelsById.get(id);
  if (!def) return 0;
  return roundUsd(def.costPerUnitUsd * Math.max(0, units));
}
