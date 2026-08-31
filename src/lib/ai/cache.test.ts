import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirst = vi.fn();
const update = vi.fn();
const upsert = vi.fn();
const deleteMany = vi.fn();

vi.mock("@/lib/db", () => ({
  default: {
    aiResponseCache: {
      findFirst: (...args: unknown[]) => findFirst(...args),
      update: (...args: unknown[]) => update(...args),
      upsert: (...args: unknown[]) => upsert(...args),
      deleteMany: (...args: unknown[]) => deleteMany(...args),
    },
  },
}));

const warn = vi.fn();
vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: (...args: unknown[]) => warn(...args),
    error: vi.fn(),
  },
}));

import {
  AI_CACHE_MAX_TTL_SECONDS,
  buildAiCacheKey,
  canonicalize,
  normalizeCacheTtlSeconds,
  purgeExpiredAiCache,
  readAiCache,
  writeAiCache,
} from "./cache";

const baseRequest = {
  nodeType: "AI_LLM",
  candidates: ["openai:gpt-4o"],
  system: "You are helpful.",
  prompt: "Summarise the invoice.",
  params: { temperature: 0.7 },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("canonicalize", () => {
  it("sorts object keys at every depth", () => {
    const canonical = canonicalize({ b: 1, a: { d: 2, c: [{ f: 3, e: 4 }] } });

    expect(JSON.stringify(canonical)).toBe(
      JSON.stringify({ a: { c: [{ e: 4, f: 3 }], d: 2 }, b: 1 }),
    );
  });

  it("drops undefined members and preserves array order", () => {
    expect(canonicalize({ a: undefined, b: 1 })).toEqual({ b: 1 });
    expect(canonicalize([3, 1, 2])).toEqual([3, 1, 2]);
  });
});

describe("buildAiCacheKey", () => {
  it("is stable across runs and insensitive to param key order", () => {
    const first = buildAiCacheKey({
      ...baseRequest,
      params: { temperature: 0.7, maxTokens: 100 },
    });
    const second = buildAiCacheKey({
      ...baseRequest,
      params: { maxTokens: 100, temperature: 0.7 },
    });

    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when any part of the request changes", () => {
    const base = buildAiCacheKey(baseRequest);

    expect(buildAiCacheKey({ ...baseRequest, prompt: "Other" })).not.toBe(base);
    expect(buildAiCacheKey({ ...baseRequest, system: "Other" })).not.toBe(base);
    expect(
      buildAiCacheKey({ ...baseRequest, nodeType: "AI_EXTRACT" }),
    ).not.toBe(base);
    expect(
      buildAiCacheKey({ ...baseRequest, candidates: ["anthropic:claude"] }),
    ).not.toBe(base);
    expect(
      buildAiCacheKey({ ...baseRequest, params: { temperature: 0.9 } }),
    ).not.toBe(base);
  });

  it("distinguishes a reordered fallback chain", () => {
    const primaryFirst = buildAiCacheKey({
      ...baseRequest,
      candidates: ["openai:gpt-4o", "anthropic:claude-3-5-sonnet"],
    });
    const reversed = buildAiCacheKey({
      ...baseRequest,
      candidates: ["anthropic:claude-3-5-sonnet", "openai:gpt-4o"],
    });

    expect(primaryFirst).not.toBe(reversed);
  });
});

describe("normalizeCacheTtlSeconds", () => {
  it("treats absent, zero, negative, and non-numeric values as disabled", () => {
    expect(normalizeCacheTtlSeconds(undefined)).toBe(0);
    expect(normalizeCacheTtlSeconds(0)).toBe(0);
    expect(normalizeCacheTtlSeconds(-30)).toBe(0);
    expect(normalizeCacheTtlSeconds("600")).toBe(0);
    expect(normalizeCacheTtlSeconds(Number.NaN)).toBe(0);
    expect(normalizeCacheTtlSeconds(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("floors fractional values and clamps to the ceiling", () => {
    expect(normalizeCacheTtlSeconds(90.7)).toBe(90);
    expect(normalizeCacheTtlSeconds(AI_CACHE_MAX_TTL_SECONDS + 1_000)).toBe(
      AI_CACHE_MAX_TTL_SECONDS,
    );
  });
});

describe("readAiCache", () => {
  const scope = { organizationId: "org_1", cacheKey: "key_1" };

  it("scopes the lookup to the workspace and to unexpired entries", async () => {
    findFirst.mockResolvedValue(null);
    const now = new Date("2026-08-30T12:00:00Z");

    await readAiCache(scope, now);

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: "org_1",
          cacheKey: "key_1",
          expiresAt: { gt: now },
        },
      }),
    );
  });

  it("returns the stored value and counts the hit", async () => {
    findFirst.mockResolvedValue({
      id: "cache_1",
      response: { value: "cached answer" },
      model: "openai:gpt-4o",
      tokensIn: 120,
      tokensOut: 40,
      costUsd: 0.0012,
    });
    const now = new Date("2026-08-30T12:00:00Z");

    const hit = await readAiCache(scope, now);

    expect(hit).toEqual({
      value: "cached answer",
      model: "openai:gpt-4o",
      tokensIn: 120,
      tokensOut: 40,
      costUsd: 0.0012,
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: "cache_1" },
      data: { hitCount: { increment: 1 }, lastHitAt: now },
    });
  });

  it("returns null on a miss without counting a hit", async () => {
    findFirst.mockResolvedValue(null);

    expect(await readAiCache(scope)).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });

  it("treats an unreadable payload as a miss and says so", async () => {
    findFirst.mockResolvedValue({
      id: "cache_1",
      response: null,
      model: "openai:gpt-4o",
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
    });

    expect(await readAiCache(scope)).toBeNull();
    expect(update).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("unreadable payload"),
      expect.anything(),
    );
  });

  it("degrades to a miss and logs when the read itself fails", async () => {
    findFirst.mockRejectedValue(new Error("connection reset"));

    expect(await readAiCache(scope)).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("cache read failed"),
      expect.anything(),
    );
  });
});

describe("writeAiCache", () => {
  const write = {
    organizationId: "org_1",
    cacheKey: "key_1",
    nodeType: "AI_LLM",
    model: "openai:gpt-4o",
    value: { text: "answer" },
    tokensIn: 100,
    tokensOut: 20,
    costUsd: 0.0005,
    ttlSeconds: 600,
  };

  it("upserts on the workspace + key pair with an expiry TTL seconds out", async () => {
    upsert.mockResolvedValue({});
    const now = new Date("2026-08-30T12:00:00Z");

    await writeAiCache(write, now);

    const call = upsert.mock.calls[0][0];
    expect(call.where).toEqual({
      organizationId_cacheKey: {
        organizationId: "org_1",
        cacheKey: "key_1",
      },
    });
    expect(call.create.response).toEqual({ value: { text: "answer" } });
    expect(call.create.expiresAt).toEqual(new Date("2026-08-30T12:10:00Z"));
  });

  it("resets the hit counter when an entry is replaced", async () => {
    upsert.mockResolvedValue({});

    await writeAiCache(write);

    expect(upsert.mock.calls[0][0].update).toMatchObject({
      hitCount: 0,
      lastHitAt: null,
    });
  });

  it("never fails the run when the write fails", async () => {
    upsert.mockRejectedValue(new Error("unique violation"));

    await expect(writeAiCache(write)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("cache write failed"),
      expect.anything(),
    );
  });
});

describe("purgeExpiredAiCache", () => {
  it("deletes only entries whose expiry has passed", async () => {
    deleteMany.mockResolvedValue({ count: 4 });
    const now = new Date("2026-08-30T12:00:00Z");

    expect(await purgeExpiredAiCache(now)).toBe(4);
    expect(deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lte: now } },
    });
  });
});
