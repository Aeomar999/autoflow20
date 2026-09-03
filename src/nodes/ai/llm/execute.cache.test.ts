import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NodeRunParams } from "@/nodes/types";
import type { LlmData } from "./definition";

/**
 * AF-M5-07: the cache seam of the AI Chat node. The AI SDK is stubbed as in
 * `execute.test.ts`; the cache module's pure key builder runs for real so the
 * fingerprints asserted here are the ones production computes.
 */
const {
  mockGenerateText,
  mockCreateOpenAI,
  mockReadAiCache,
  mockWriteAiCache,
} = vi.hoisted(() => ({
  mockGenerateText: vi.fn(),
  mockCreateOpenAI: vi.fn(),
  mockReadAiCache: vi.fn(),
  mockWriteAiCache: vi.fn(),
}));

vi.mock("ai", () => ({
  generateText: mockGenerateText,
  generateObject: vi.fn(),
  jsonSchema: vi.fn((schema: unknown) => schema),
}));
vi.mock("@ai-sdk/openai", () => ({ createOpenAI: mockCreateOpenAI }));
vi.mock("@ai-sdk/anthropic", () => ({ createAnthropic: vi.fn() }));
vi.mock("@ai-sdk/google", () => ({ createGoogleGenerativeAI: vi.fn() }));

vi.mock("@/lib/ai/cache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/cache")>();
  return {
    ...actual,
    readAiCache: mockReadAiCache,
    writeAiCache: mockWriteAiCache,
  };
});

import { withResolve } from "@/nodes/shared/test-params";
import { execute } from "./execute";

const step = {
  ai: {
    wrap: async <T>(
      _id: string,
      fn: (...args: unknown[]) => Promise<T>,
      ...args: unknown[]
    ): Promise<T> => fn(...args),
  },
} as unknown as NodeRunParams["step"];

const makeParams = (
  data: Partial<LlmData>,
  // Explicit override object, not a defaulted parameter: passing `undefined`
  // to a defaulted parameter would silently restore the default org.
  orgOverride?: { organizationId?: string },
): NodeRunParams<LlmData> =>
  withResolve({
    nodeId: "node_1",
    userId: "user_1",
    organizationId: orgOverride ? orgOverride.organizationId : "org_1",
    context: { data: { question: "6 times 7" }, config: {} },
    credentials: { openaiCredentialId: { apiKey: "sk-test" } },
    data: {
      variableName: "chatReply",
      model: "openai:gpt-4o",
      userPrompt: "Answer {{data.question}}",
      temperature: 0.7,
      jsonMode: false,
      ...data,
    } as LlmData,
    step,
    publish: vi.fn(async () => {}),
  }) as NodeRunParams<LlmData>;

beforeEach(() => {
  vi.clearAllMocks();
  mockGenerateText.mockResolvedValue({
    steps: [{ content: [{ type: "text", text: "42" }] }],
    usage: { promptTokens: 10, completionTokens: 5 },
  });
  mockCreateOpenAI.mockReturnValue((modelId: string) => ({
    providerId: "openai",
    modelId,
  }));
  mockReadAiCache.mockResolvedValue(null);
  mockWriteAiCache.mockResolvedValue(undefined);
});

describe("AI_LLM response cache", () => {
  it("returns the cached text without calling the model", async () => {
    mockReadAiCache.mockResolvedValue({
      value: "cached 42",
      model: "openai:gpt-4o",
      tokensIn: 10,
      tokensOut: 5,
      costUsd: 0.000075,
    });

    const result = await execute(makeParams({ cacheTtlSeconds: 600 }));

    expect(mockGenerateText).not.toHaveBeenCalled();
    expect(result.chatReply).toEqual({
      text: "cached 42",
      model: "openai:gpt-4o",
    });
    expect(result.__usage).toMatchObject({
      cacheHit: true,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
    });
  });

  it("calls the model and stores the answer under this workspace on a miss", async () => {
    const result = await execute(makeParams({ cacheTtlSeconds: 600 }));

    expect(mockGenerateText).toHaveBeenCalledTimes(1);
    expect(result.__usage).toMatchObject({ cacheHit: false });
    expect(mockWriteAiCache).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_1",
        nodeType: "AI_LLM",
        model: "openai:gpt-4o",
        value: "42",
        ttlSeconds: 600,
      }),
    );
  });

  it("reuses the same key for an identical request and a new key when a parameter changes", async () => {
    await execute(makeParams({ cacheTtlSeconds: 600 }));
    await execute(makeParams({ cacheTtlSeconds: 600 }));
    await execute(makeParams({ cacheTtlSeconds: 600, temperature: 0.2 }));

    const keys = mockReadAiCache.mock.calls.map((call) => call[0].cacheKey);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
  });

  it("skips the cache entirely when no TTL is configured", async () => {
    const result = await execute(makeParams({}));

    expect(mockReadAiCache).not.toHaveBeenCalled();
    expect(mockWriteAiCache).not.toHaveBeenCalled();
    expect(result.__usage).toMatchObject({ cacheHit: null });
  });

  it("skips the cache when the run carries no workspace", async () => {
    const result = await execute(
      makeParams({ cacheTtlSeconds: 600 }, { organizationId: undefined }),
    );

    expect(mockReadAiCache).not.toHaveBeenCalled();
    expect(mockWriteAiCache).not.toHaveBeenCalled();
    expect(result.__usage).toMatchObject({ cacheHit: null });
  });
});
