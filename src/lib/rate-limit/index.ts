import { MemoryRateLimitStore } from "./store";

export type { AuthSurface } from "./auth";
export { authBucket, deriveAuthRateKey, detectAuthSurface } from "./auth";
export {
  AUTH_BUCKETS,
  type BucketConfig,
  MemoryRateLimitStore,
  PLAN_BUCKETS,
  type RateLimitDecision,
  type RateLimitStore,
  resolvePlanBucket,
} from "./store";

/**
 * Per-process limiter used by auth, webhook, and tRPC surfaces. Deliberately a
 * module singleton so in-process surfaces share one bucket map; it is still
 * per-instance (no cross-replica sharing) by design — see `store.ts`.
 */
export const memoryRateLimiter = new MemoryRateLimitStore();
