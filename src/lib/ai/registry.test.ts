import { describe, expect, it } from "vitest";
import { credentialDefsById } from "@/features/credentials/credential-types";
import {
  AI_ADAPTERS,
  AI_CAPABILITIES,
  AI_PROVIDERS,
  aiModelDefs,
  aiModelId,
  aiProviderById,
  aiProviderDefs,
  defaultAiModelId,
  estimateRunCostUsd,
  findAiModel,
  listAiModels,
  resolveAiModel,
  UnknownAiModelError,
} from "./registry";

describe("registry data integrity", () => {
  it("registers the six plan providers exactly", () => {
    expect(AI_PROVIDERS).toEqual([
      "openai",
      "anthropic",
      "google",
      "groq",
      "deepseek",
      "ollama",
    ]);
  });

  it("gives every model a unique, provider-prefixed id", () => {
    const ids = new Set<string>();
    for (const def of aiModelDefs) {
      const id = aiModelId(def.provider, def.model);
      expect(ids.has(id)).toBe(false);
      ids.add(id);
      expect(id).toMatch(/^[a-z]+:[a-zA-Z0-9./-]+$/);
    }
  });

  it("every model references a registered provider and a valid adapter", () => {
    for (const def of aiModelDefs) {
      expect(aiProviderById.has(def.provider)).toBe(true);
      expect(AI_ADAPTERS).toContain(def.adapter);
    }
  });

  it("every provider has at least one model and a registered default", () => {
    for (const providerId of AI_PROVIDERS) {
      expect(listAiModels(providerId).length).toBeGreaterThan(0);
      const def = aiProviderById.get(providerId);
      expect(def).toBeDefined();
      if (def !== undefined) {
        expect(
          findAiModel(aiModelId(providerId, def.defaultModel)),
        ).toBeDefined();
      }
    }
  });

  it("keyed providers declare a registered credential type, keyless ones none", () => {
    for (const def of aiProviderDefs) {
      if (def.requiresKey) {
        expect(def.credentialType).toBeDefined();
        if (def.credentialType !== undefined) {
          expect(credentialDefsById.has(def.credentialType)).toBe(true);
        }
      } else {
        expect(def.credentialType).toBeUndefined();
      }
    }
  });

  it("groq and deepseek map to the new credential types", () => {
    expect(aiProviderById.get("groq")?.credentialType).toBe("groq.apiKey");
    expect(aiProviderById.get("deepseek")?.credentialType).toBe(
      "deepseek.apiKey",
    );
  });

  it("pricing and context metadata are finite and sane", () => {
    for (const def of aiModelDefs) {
      expect(def.contextWindow).toBeGreaterThan(0);
      expect(def.inputCostPer1M).toBeGreaterThanOrEqual(0);
      expect(def.outputCostPer1M).toBeGreaterThanOrEqual(0);
      expect(def.capabilities.length).toBeGreaterThan(0);
      for (const capability of def.capabilities) {
        expect(AI_CAPABILITIES).toContain(capability);
      }
    }
  });
});

describe("lookup", () => {
  it("findAiModel resolves an exact provider:model id", () => {
    expect(findAiModel("openai:gpt-4o-mini")).toMatchObject({
      provider: "openai",
      model: "gpt-4o-mini",
    });
  });

  it("findAiModel returns undefined for unknown ids", () => {
    expect(findAiModel("openai:does-not-exist")).toBeUndefined();
    expect(findAiModel("nope:nope")).toBeUndefined();
  });

  it("listAiModels filters by provider", () => {
    expect(listAiModels("groq").map((def) => def.model)).toEqual([
      "openai/gpt-oss-120b",
      "openai/gpt-oss-20b",
    ]);
    expect(listAiModels().length).toBe(aiModelDefs.length);
  });

  it("defaultAiModelId returns the provider's default", () => {
    expect(defaultAiModelId("openai")).toBe("openai:gpt-4o-mini");
    expect(defaultAiModelId("ollama")).toBe("ollama:mistral");
    expect(() => defaultAiModelId("nope" as never)).toThrow(
      UnknownAiModelError,
    );
  });

  it("resolveAiModel returns the exact model when named", () => {
    expect(resolveAiModel("groq", "openai/gpt-oss-20b").model).toBe(
      "openai/gpt-oss-20b",
    );
  });

  it("resolveAiModel falls back to the provider default when model is omitted", () => {
    expect(resolveAiModel("openai")).toBe(findAiModel("openai:gpt-4o-mini"));
  });

  it("resolveAiModel falls back to the provider default for an unknown model name", () => {
    expect(resolveAiModel("openai", "typo-model").model).toBe("gpt-4o-mini");
  });

  it("resolveAiModel throws for an unregistered provider instead of guessing", () => {
    expect(() => resolveAiModel("nope" as never)).toThrow(UnknownAiModelError);
  });
});

describe("cost estimation", () => {
  it("computes per-1M input and output costs", () => {
    expect(
      estimateRunCostUsd("openai:gpt-4o-mini", {
        inputTokens: 1_000_000,
        outputTokens: 0,
      }),
    ).toBe(0.15);
    expect(
      estimateRunCostUsd("openai:gpt-4o-mini", {
        inputTokens: 0,
        outputTokens: 1_000_000,
      }),
    ).toBe(0.6);
  });

  it("computes a mixed run from both token classes", () => {
    expect(
      estimateRunCostUsd("openai:gpt-4o-mini", {
        inputTokens: 500_000,
        outputTokens: 200_000,
      }),
    ).toBe(0.195);
  });

  it("is zero for local (ollama) models", () => {
    expect(
      estimateRunCostUsd("ollama:mistral", {
        inputTokens: 123_456,
        outputTokens: 654_321,
      }),
    ).toBe(0);
  });

  it("returns zero for a zero-token run", () => {
    expect(
      estimateRunCostUsd("openai:gpt-4o-mini", {
        inputTokens: 0,
        outputTokens: 0,
      }),
    ).toBe(0);
  });

  it("throws for unknown models", () => {
    expect(() =>
      estimateRunCostUsd("openai:nope", {
        inputTokens: 10,
        outputTokens: 10,
      }),
    ).toThrow(UnknownAiModelError);
  });
});
