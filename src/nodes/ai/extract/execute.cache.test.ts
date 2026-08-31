import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NodeRunParams } from "@/nodes/types";
import type { ExtractData } from "./definition";

/**
 * AF-M5-07: the cache seam of the AI Extract node. The extraction schema is
 * part of the fingerprint, so widening the field list must re-ask the model
 * instead of replaying the narrower answer.
 */
const {
  mockGenerateObject,
  mockCreateOpenAI,
  mockReadAiCache,
  mockWriteAiCache,
} = vi.hoisted(() => ({
  mockGenerateObject: vi.fn(),
  mockCreateOpenAI: vi.fn(),
  mockReadAiCache: vi.fn(),
  mockWriteAiCache: vi.fn(),
}));

vi.mock("ai", () => ({
  generateObject: mockGenerateObject,
  generateText: vi.fn(),
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

const makeParams = (data: Partial<ExtractData>): NodeRunParams<ExtractData> =>
  ({
    nodeId: "node_1",
    userId: "user_1",
    organizationId: "org_1",
    context: { data: { body: "Invoice total is 42 EUR" }, config: {} },
    credentials: { openaiCredentialId: { apiKey: "sk-test" } },
    data: {
      variableName: "invoice",
      model: "openai:gpt-4o",
      content: "{{data.body}}",
      fields: [{ name: "total", type: "number" }],
      ...data,
    } as ExtractData,
    step,
    publish: vi.fn(async () => {}),
  }) as NodeRunParams<ExtractData>;

beforeEach(() => {
  vi.clearAllMocks();
  mockGenerateObject.mockResolvedValue({
    object: { total: 42 },
    usage: { promptTokens: 12, completionTokens: 6 },
  });
  mockCreateOpenAI.mockReturnValue((modelId: string) => ({
    providerId: "openai",
    modelId,
  }));
  mockReadAiCache.mockResolvedValue(null);
  mockWriteAiCache.mockResolvedValue(undefined);
});

describe("AI_EXTRACT response cache", () => {
  it("returns the cached object without calling the model", async () => {
    mockReadAiCache.mockResolvedValue({
      value: { total: 99 },
      model: "openai:gpt-4o",
      tokensIn: 12,
      tokensOut: 6,
      costUsd: 0.00009,
    });

    const result = await execute(makeParams({ cacheTtlSeconds: 3600 }));

    expect(mockGenerateObject).not.toHaveBeenCalled();
    expect(result.invoice).toEqual({ total: 99 });
    expect(result.__usage).toMatchObject({
      cacheHit: true,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
    });
  });

  it("stores the extraction under this workspace on a miss", async () => {
    const result = await execute(makeParams({ cacheTtlSeconds: 3600 }));

    expect(mockGenerateObject).toHaveBeenCalledTimes(1);
    expect(result.__usage).toMatchObject({ cacheHit: false });
    expect(mockWriteAiCache).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_1",
        nodeType: "AI_EXTRACT",
        value: { total: 42 },
        ttlSeconds: 3600,
      }),
    );
  });

  it("uses a different key when the extraction schema changes", async () => {
    await execute(makeParams({ cacheTtlSeconds: 3600 }));
    await execute(
      makeParams({
        cacheTtlSeconds: 3600,
        fields: [
          { name: "total", type: "number" },
          { name: "currency", type: "string" },
        ],
      }),
    );

    const [first, second] = mockReadAiCache.mock.calls.map(
      (call) => call[0].cacheKey,
    );
    expect(first).not.toBe(second);
  });

  it("skips the cache entirely when no TTL is configured", async () => {
    const result = await execute(makeParams({}));

    expect(mockReadAiCache).not.toHaveBeenCalled();
    expect(mockWriteAiCache).not.toHaveBeenCalled();
    expect(result.__usage).toMatchObject({ cacheHit: null });
  });
});
