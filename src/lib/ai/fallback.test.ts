import { NonRetriableError } from "inngest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const readAiCache = vi.fn();
const writeAiCache = vi.fn();

vi.mock("./cache", () => ({
  readAiCache: (...args: unknown[]) => readAiCache(...args),
  writeAiCache: (...args: unknown[]) => writeAiCache(...args),
}));

import {
  type CandidateContext,
  executeWithFallback,
  parseModelChain,
  pickRunUsage,
  resolveCandidate,
  splitModelId,
} from "./fallback";

describe("splitModelId", () => {
  it("splits provider:model correctly", () => {
    expect(splitModelId("openai:gpt-4o")).toEqual({
      provider: "openai",
      modelHint: "gpt-4o",
    });
    expect(splitModelId("anthropic:claude-3-5-sonnet")).toEqual({
      provider: "anthropic",
      modelHint: "claude-3-5-sonnet",
    });
  });

  it("handles bare provider and undefined/empty", () => {
    expect(splitModelId("openai")).toEqual({
      provider: "openai",
      modelHint: undefined,
    });
    expect(splitModelId("")).toEqual({
      provider: "",
      modelHint: undefined,
    });
    expect(splitModelId(undefined)).toEqual({
      provider: "",
      modelHint: undefined,
    });
  });
});

describe("parseModelChain", () => {
  it("defaults to openai when no models provided", () => {
    expect(parseModelChain(undefined, undefined)).toEqual(["openai"]);
    expect(parseModelChain("", "")).toEqual(["openai"]);
  });

  it("parses primary model alone", () => {
    expect(parseModelChain("openai:gpt-4o", undefined)).toEqual([
      "openai:gpt-4o",
    ]);
  });

  it("parses comma-, semicolon-, and newline-separated fallback models with deduplication", () => {
    expect(
      parseModelChain(
        "openai:gpt-4o",
        "anthropic:claude-3-5-sonnet, google:gemini-1.5-flash; openai:gpt-4o\nollama:mistral",
      ),
    ).toEqual([
      "openai:gpt-4o",
      "anthropic:claude-3-5-sonnet",
      "google:gemini-1.5-flash",
      "ollama:mistral",
    ]);
  });
});

describe("resolveCandidate", () => {
  it("resolves valid candidate with required credential", () => {
    const candidate = resolveCandidate("openai:gpt-4o", {
      openaiCredentialId: { apiKey: "test-key" },
    });
    expect(candidate.fullModelId).toBe("openai:gpt-4o");
    expect(candidate.apiKey).toBe("test-key");
    expect(candidate.provider).toBe("openai");
  });

  it("throws NonRetriableError for unknown provider", () => {
    expect(() => resolveCandidate("unknownprov:model", {})).toThrow(
      NonRetriableError,
    );
  });

  it("throws NonRetriableError when credential is required but missing", () => {
    expect(() => resolveCandidate("openai:gpt-4o", {})).toThrow(
      /credential required for provider "openai"/,
    );
  });

  /**
   * Credentials are chosen by provider, never by adapter.
   *
   * Groq, DeepSeek and Ollama speak the OpenAI wire format, so their models
   * carry `adapter: "openai"`. Selecting the credential by adapter therefore
   * handed them `openaiCredentialId` — which both failed to authenticate and
   * transmitted a live OpenAI key to `api.groq.com` / `api.deepseek.com`. The
   * `requiresKey && !apiKey` guard could not catch it: a key was present, it
   * was simply the wrong one.
   */
  it("uses the groq credential for a groq model, not the openai one", () => {
    const candidate = resolveCandidate("groq:openai/gpt-oss-120b", {
      openaiCredentialId: { apiKey: "sk-openai-secret" },
      groqCredentialId: { apiKey: "gsk-groq-key" },
    });

    expect(candidate.provider).toBe("groq");
    expect(candidate.apiKey).toBe("gsk-groq-key");
  });

  it("never sends the openai key to another provider host", () => {
    // The leak, pinned: an OpenAI credential alone must not satisfy groq.
    expect(() =>
      resolveCandidate("groq:openai/gpt-oss-120b", {
        openaiCredentialId: { apiKey: "sk-openai-secret" },
      }),
    ).toThrow(/credential required for provider "groq"/);

    expect(() =>
      resolveCandidate("deepseek:deepseek-chat", {
        openaiCredentialId: { apiKey: "sk-openai-secret" },
      }),
    ).toThrow(/credential required for provider "deepseek"/);
  });

  it("resolves keyless provider (ollama) without credential", () => {
    const candidate = resolveCandidate("ollama:mistral", {});
    expect(candidate.fullModelId).toBe("ollama:mistral");
    expect(candidate.provider).toBe("ollama");
  });
});

describe("executeWithFallback", () => {
  it("succeeds on first candidate", async () => {
    const runFn = vi.fn(
      async (ctx: CandidateContext) => `result-${ctx.fullModelId}`,
    );
    const res = await executeWithFallback(
      ["openai:gpt-4o"],
      { openaiCredentialId: { apiKey: "key" } },
      "AI Test Node",
      runFn,
    );
    expect(res.servedModel).toBe("openai:gpt-4o");
    expect(res.result).toBe("result-openai:gpt-4o");
    expect(res.attempts).toEqual([]);
    expect(runFn).toHaveBeenCalledTimes(1);
  });

  it("falls back to second candidate when primary fails", async () => {
    let callCount = 0;
    const runFn = vi.fn(async (ctx: CandidateContext) => {
      callCount++;
      if (callCount === 1) {
        throw new Error("Rate limit exceeded 429");
      }
      return `success-${ctx.fullModelId}`;
    });

    const res = await executeWithFallback(
      ["openai:gpt-4o", "anthropic:claude-3-5-sonnet"],
      {
        openaiCredentialId: { apiKey: "open-key" },
        anthropicCredentialId: { apiKey: "ant-key" },
      },
      "AI Test Node",
      runFn,
    );

    expect(res.servedModel).toBe("anthropic:claude-3-5-sonnet");
    expect(res.result).toBe("success-anthropic:claude-3-5-sonnet");
    expect(res.attempts).toEqual([
      { model: "openai:gpt-4o", error: "Rate limit exceeded 429" },
    ]);
    expect(runFn).toHaveBeenCalledTimes(2);
  });

  it("throws detailed error when all candidates in chain fail", async () => {
    const runFn = vi.fn(async (ctx: CandidateContext) => {
      throw new Error(`Outage on ${ctx.fullModelId}`);
    });

    await expect(
      executeWithFallback(
        ["openai:gpt-4o", "anthropic:claude-3-5-sonnet"],
        {
          openaiCredentialId: { apiKey: "open-key" },
          anthropicCredentialId: { apiKey: "ant-key" },
        },
        "AI Test Node",
        runFn,
      ),
    ).rejects.toThrow(
      /AI Test Node: all candidate models in fallback chain failed: \[openai:gpt-4o\]: Outage on openai:gpt-4o; \[anthropic:claude-3-5-sonnet\]: Outage on anthropic:claude-3-5-sonnet/,
    );
  });

  it("calculates tokens and cost for the served model", async () => {
    const res = await executeWithFallback(
      ["openai:gpt-4o"],
      { openaiCredentialId: { apiKey: "key" } },
      "AI Test Node",
      async () => ({
        value: "response text",
        usage: { promptTokens: 1000, completionTokens: 500 },
      }),
    );

    expect(res.usage).toEqual({
      tokensIn: 1000,
      tokensOut: 500,
      costUsd: 0.0075,
      model: "openai:gpt-4o",
      cacheHit: null,
    });
  });
});

describe("executeWithFallback response cache (AF-M5-07)", () => {
  const credentials = { openaiCredentialId: { apiKey: "key" } };
  const cacheOptions = {
    organizationId: "org_1",
    nodeType: "AI_LLM",
    cacheKey: "key_1",
    ttlSeconds: 600,
  };

  beforeEach(() => {
    readAiCache.mockReset();
    writeAiCache.mockReset();
    readAiCache.mockResolvedValue(null);
    writeAiCache.mockResolvedValue(undefined);
  });

  it("serves a hit without calling any provider and reports no spend", async () => {
    readAiCache.mockResolvedValue({
      value: "cached answer",
      model: "openai:gpt-4o",
      tokensIn: 900,
      tokensOut: 300,
      costUsd: 0.0075,
    });
    const runFn = vi.fn();

    const res = await executeWithFallback(
      ["openai:gpt-4o"],
      credentials,
      "AI Test Node",
      runFn,
      cacheOptions,
    );

    expect(runFn).not.toHaveBeenCalled();
    expect(res.result).toBe("cached answer");
    expect(res.servedModel).toBe("openai:gpt-4o");
    expect(res.usage).toEqual({
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      model: "openai:gpt-4o",
      cacheHit: true,
    });
  });

  it("stores the response after a miss and marks the run a miss", async () => {
    const res = await executeWithFallback(
      ["openai:gpt-4o"],
      credentials,
      "AI Test Node",
      async () => ({
        value: "fresh answer",
        usage: { promptTokens: 1000, completionTokens: 500 },
      }),
      cacheOptions,
    );

    expect(res.usage.cacheHit).toBe(false);
    expect(writeAiCache).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_1",
        cacheKey: "key_1",
        nodeType: "AI_LLM",
        model: "openai:gpt-4o",
        value: "fresh answer",
        tokensIn: 1000,
        tokensOut: 500,
        costUsd: 0.0075,
        ttlSeconds: 600,
      }),
    );
  });

  it("does not touch the cache when the node configured no TTL", async () => {
    const res = await executeWithFallback(
      ["openai:gpt-4o"],
      credentials,
      "AI Test Node",
      async () => ({ value: "fresh answer" }),
      { ...cacheOptions, ttlSeconds: 0 },
    );

    expect(readAiCache).not.toHaveBeenCalled();
    expect(writeAiCache).not.toHaveBeenCalled();
    expect(res.usage.cacheHit).toBeNull();
  });

  it("does not touch the cache when the run has no workspace context", async () => {
    const res = await executeWithFallback(
      ["openai:gpt-4o"],
      credentials,
      "AI Test Node",
      async () => ({ value: "fresh answer" }),
      { ...cacheOptions, organizationId: undefined },
    );

    expect(readAiCache).not.toHaveBeenCalled();
    expect(writeAiCache).not.toHaveBeenCalled();
    expect(res.usage.cacheHit).toBeNull();
  });

  it("never writes a failed run to the cache", async () => {
    await expect(
      executeWithFallback(
        ["openai:gpt-4o"],
        credentials,
        "AI Test Node",
        async () => {
          throw new Error("provider outage");
        },
        cacheOptions,
      ),
    ).rejects.toThrow(/provider outage/);

    expect(writeAiCache).not.toHaveBeenCalled();
  });
});

describe("pickRunUsage (AF-M8-19)", () => {
  it("lifts the v6 flat token counts", () => {
    expect(
      pickRunUsage({ usage: { inputTokens: 120, outputTokens: 45 } }),
    ).toEqual({ inputTokens: 120, outputTokens: 45 });
  });

  it("still reads the older prompt/completion names", () => {
    // The fallback meter accepts either pair; a provider that reports the old
    // names must not silently meter as zero.
    expect(
      pickRunUsage({ usage: { promptTokens: 10, completionTokens: 3 } }),
    ).toEqual({ promptTokens: 10, completionTokens: 3 });
  });

  it("drops v6's nested token details", () => {
    // This is the whole point: v6 widened `usage` beyond a flat map of
    // numbers, and passing it through would persist new nested provider data
    // into every AI node's output context and into the trace.
    const picked = pickRunUsage({
      usage: {
        inputTokens: 7,
        outputTokens: 2,
        inputTokenDetails: { cacheReadTokens: 5, noCacheTokens: 2 },
        outputTokenDetails: { reasoningTokens: 1 },
        raw: { anything: true },
      },
    });

    expect(picked).toEqual({ inputTokens: 7, outputTokens: 2 });
  });

  it("ignores counts that are not finite numbers", () => {
    // Provider-shaped data crossing a version boundary: a missing or broken
    // count must meter as absent rather than as NaN.
    expect(
      pickRunUsage({
        usage: { inputTokens: Number.NaN, outputTokens: "12", promptTokens: 4 },
      }),
    ).toEqual({ promptTokens: 4 });
  });

  it("returns undefined when there is nothing to meter", () => {
    expect(pickRunUsage(undefined)).toBeUndefined();
    expect(pickRunUsage(null)).toBeUndefined();
    expect(pickRunUsage("nope")).toBeUndefined();
    expect(pickRunUsage({})).toBeUndefined();
    expect(pickRunUsage({ usage: null })).toBeUndefined();
    expect(pickRunUsage({ usage: {} })).toBeUndefined();
    expect(pickRunUsage({ usage: { inputTokenDetails: {} } })).toBeUndefined();
  });

  it("keeps a genuine zero rather than discarding it", () => {
    // 0 output tokens is a real measurement, not a missing one.
    expect(
      pickRunUsage({ usage: { inputTokens: 9, outputTokens: 0 } }),
    ).toEqual({ inputTokens: 9, outputTokens: 0 });
  });
});
