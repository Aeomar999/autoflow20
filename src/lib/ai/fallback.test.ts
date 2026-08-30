import { NonRetriableError } from "inngest";
import { describe, expect, it, vi } from "vitest";
import {
  type CandidateContext,
  executeWithFallback,
  parseModelChain,
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
});
