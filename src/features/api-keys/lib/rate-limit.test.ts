import { describe, expect, it } from "vitest";
import {
  API_BUCKET_BY_PLAN,
  type BucketConfig,
  resolveApiBucketLimits,
  TokenBucketLimiter,
} from "./rate-limit";

const cfg: BucketConfig = { capacity: 3, refillPerSecond: 1 };

function fixedNow(startMs: number) {
  let current = startMs;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

describe("TokenBucketLimiter", () => {
  it("allows up to capacity immediately and then blocks", () => {
    const clock = fixedNow(0);
    const limiter = new TokenBucketLimiter(clock.now);

    expect(limiter.consume("k", cfg).allowed).toBe(true);
    expect(limiter.consume("k", cfg).allowed).toBe(true);
    expect(limiter.consume("k", cfg).allowed).toBe(true);
    const blocked = limiter.consume("k", cfg);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it("refills over time and reports remaining", () => {
    const clock = fixedNow(0);
    const limiter = new TokenBucketLimiter(clock.now);

    limiter.consume("k", cfg);
    limiter.consume("k", cfg);
    const third = limiter.consume("k", cfg);
    expect(third.remaining).toBe(0);

    clock.advance(1500); // 1.5s -> 1.5 tokens
    const next = limiter.consume("k", cfg);
    expect(next.allowed).toBe(true);
    expect(next.remaining).toBe(0);
  });

  it("keeps separate buckets per key", () => {
    const clock = fixedNow(0);
    const limiter = new TokenBucketLimiter(clock.now);

    for (let i = 0; i < 3; i++) limiter.consume("a", cfg);
    expect(limiter.consume("a", cfg).allowed).toBe(false);

    expect(limiter.consume("b", cfg).allowed).toBe(true);
  });
});

describe("resolveApiBucketLimits", () => {
  it("maps known plans and collapses unknown to FREE", () => {
    expect(resolveApiBucketLimits("FREE")).toBe(API_BUCKET_BY_PLAN.FREE);
    expect(resolveApiBucketLimits("PRO")).toBe(API_BUCKET_BY_PLAN.PRO);
    expect(resolveApiBucketLimits("ENTERPRISE")).toBe(
      API_BUCKET_BY_PLAN.ENTERPRISE,
    );
    expect(resolveApiBucketLimits(null)).toBe(API_BUCKET_BY_PLAN.FREE);
    expect(resolveApiBucketLimits("FUTURE_PLAN")).toBe(API_BUCKET_BY_PLAN.FREE);
  });
});
