/**
 * In-memory token-bucket rate limiter for the public API (AF-M8-01).
 *
 * Pure (in-memory Map) so it is unit-testable without a DB. The store is
 * PER-INSTANCE: it does not share state across replicas. A shared distributed
 * store replaces this in AF-M8-02, which owns the full rate-limit design for
 * auth, webhook, and API surfaces (`docs/architecture/security.md` §8).
 */

export interface BucketConfig {
  /** Maximum burst of tokens the bucket can hold. */
  capacity: number;
  /** Tokens added per second up to capacity. */
  refillPerSecond: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Seconds until the bucket is expected to have room again (429 Retry-After). */
  retryAfterSeconds: number;
  /** Tokens remaining in the current window (X-RateLimit-Remaining). */
  remaining: number;
  /** The bucket capacity (X-RateLimit-Limit). */
  limit: number;
}

interface BucketState {
  tokens: number;
  lastRefillMs: number;
}

export class TokenBucketLimiter {
  private buckets = new Map<string, BucketState>();

  /**
   * @param now time source, injectable for deterministic tests.
   */
  constructor(private readonly now: () => number = Date.now) {}

  consume(key: string, config: BucketConfig): RateLimitDecision {
    const t = this.now();
    const state = this.buckets.get(key) ?? {
      tokens: config.capacity,
      lastRefillMs: t,
    };
    const elapsedSec = Math.max(0, (t - state.lastRefillMs) / 1000);
    state.tokens = Math.min(
      config.capacity,
      state.tokens + elapsedSec * config.refillPerSecond,
    );
    state.lastRefillMs = t;

    if (state.tokens >= 1) {
      state.tokens -= 1;
      this.buckets.set(key, state);
      return {
        allowed: true,
        retryAfterSeconds: 0,
        remaining: Math.floor(state.tokens),
        limit: config.capacity,
      };
    }

    this.buckets.set(key, state);
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((1 - state.tokens) / config.refillPerSecond),
    );
    return {
      allowed: false,
      retryAfterSeconds,
      remaining: 0,
      limit: config.capacity,
    };
  }
}

/** Default per-plan buckets for the public API. Unknown/null plans collapse to
 * FREE (never widen access), mirroring ADR-0010's FREE-collapse rule. */
export const API_BUCKET_BY_PLAN: Readonly<Record<string, BucketConfig>> = {
  FREE: { capacity: 60, refillPerSecond: 1 },
  STARTER: { capacity: 600, refillPerSecond: 10 },
  PRO: { capacity: 6_000, refillPerSecond: 100 },
  ENTERPRISE: { capacity: 60_000, refillPerSecond: 1_000 },
};

const API_BUCKET_FREE = API_BUCKET_BY_PLAN.FREE;

export function resolveApiBucketLimits(
  plan: string | null | undefined,
): BucketConfig {
  return (plan && API_BUCKET_BY_PLAN[plan]) || API_BUCKET_FREE;
}
