/**
 * Public-API rate limiting (AF-M8-01), re-exported from the shared
 * `src/lib/rate-limit` module (AF-M8-02). The token bucket and plan buckets now
 * live in one place used by every rate-limited surface; this file keeps the
 * AF-M8-01 public names so `public-api.ts` and its tests stay intact.
 */
export {
  type BucketConfig,
  MemoryRateLimitStore as TokenBucketLimiter,
  PLAN_BUCKETS as API_BUCKET_BY_PLAN,
  type RateLimitDecision,
  resolvePlanBucket as resolveApiBucketLimits,
} from "@/lib/rate-limit";
