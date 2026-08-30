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
    defaultModel: "gemini-1.5-flash",
  },
  {
    id: "groq",
    label: "Groq",
    credentialType: "groq.apiKey",
    requiresKey: true,
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
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
  {
    provider: "google",
    model: "gemini-1.5-flash",
    adapter: "google",
    contextWindow: 1_048_576,
    capabilities: ["chat", "json", "vision", "audio", "toolUse"],
    inputCostPer1M: 0.075,
    outputCostPer1M: 0.3,
  },
  {
    provider: "google",
    model: "gemini-1.5-pro",
    adapter: "google",
    contextWindow: 2_097_152,
    capabilities: ["chat", "json", "vision", "audio", "toolUse"],
    inputCostPer1M: 1.25,
    outputCostPer1M: 5,
  },
  // Groq (OpenAI-compatible)
  {
    provider: "groq",
    model: "llama-3.3-70b-versatile",
    adapter: "openai",
    contextWindow: 131_072,
    capabilities: ["chat", "json", "toolUse"],
    inputCostPer1M: 0.59,
    outputCostPer1M: 0.79,
  },
  {
    provider: "groq",
    model: "llama-3.1-8b-instant",
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
