/**
 * Shared rate-limit primitives (AF-M8-02).
 *
 * One token-bucket store backs every rate-limited surface: the public REST API
 * (AF-M8-01), trigger webhooks, auth endpoints, and tRPC mutations. The store
 * is an injectable interface so a distributed backing store (Redis/Upstash, or
 * Postgres) can replace the in-memory default without touching any caller — the
 * multi-instance store is a documented follow-up.
 *
 * See `docs/architecture/security.md` §8 for the surface→limit table and
 * `docs/decisions/0012-public-api-and-api-keys.md` §4 for the store rationale.
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
  /** Tokens remaining in the current window (X-RateLimit-Remaining / internal). */
  remaining: number;
  /** The bucket capacity (X-RateLimit-Limit / internal). */
  limit: number;
}

export interface RateLimitStore {
  consume(key: string, config: BucketConfig): RateLimitDecision;
}

interface BucketState {
  tokens: number;
  lastRefillMs: number;
}

/**
 * In-memory token-bucket store. Per-instance only: it does not share state
 * across replicas. The authoritative store for local dev and the default in a
 * single-instance deploy; a distributed store is AF-M8-02's explicitly
 * documented follow-up behind the `RateLimitStore` interface.
 */
export class MemoryRateLimitStore implements RateLimitStore {
  private buckets = new Map<string, BucketState>();

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

/** Default per-plan buckets for tenant-facing surfaces. Unknown/null plans
 * collapse to FREE (never widen access), mirroring ADR-0010's FREE-collapse. */
export const PLAN_BUCKETS: Readonly<Record<string, BucketConfig>> = {
  FREE: { capacity: 60, refillPerSecond: 1 },
  STARTER: { capacity: 600, refillPerSecond: 10 },
  PRO: { capacity: 6_000, refillPerSecond: 100 },
  ENTERPRISE: { capacity: 60_000, refillPerSecond: 1_000 },
};

const PLAN_BUCKET_FREE = PLAN_BUCKETS.FREE;

export function resolvePlanBucket(
  plan: string | null | undefined,
): BucketConfig {
  return (plan && PLAN_BUCKETS[plan]) || PLAN_BUCKET_FREE;
}

/**
 * Auth-surface buckets per `security.md` §8: tighter than tenant buckets
 * because these defend credential attacks, not feature usage.
 */
export const AUTH_BUCKETS = {
  /** Login / signup: 5 attempts per 15 minutes per (IP, email). */
  SIGN_IN: { capacity: 5, refillPerSecond: 5 / (15 * 60) },
  /** Password reset / forget-password: 3 requests per hour per email. */
  RESET: { capacity: 3, refillPerSecond: 3 / (60 * 60) },
} as const satisfies Record<string, BucketConfig>;
