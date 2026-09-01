# 0013 - Shared injectable rate-limit store (in-memory default, no new dependency)

**Status:** Accepted (AF-M8-02).

## Context

Rate limiting was introduced piecemeal across three surfaces, each with its own
scheme and its own store:

- **Webhook ingress** (`/api/webhooks/[workflowId]/[path]`, AF-M4-03) used a
  fixed 60-requests/minute counter, independent of plan.
- **Public REST v1** (`src/app/api/v1`, AF-M8-01) used a per-key in-memory
  token bucket whose limits derive from `Organization.plan`
  (`src/features/api-keys/lib/rate-limit.ts`, ADR-0010 plan collapse). ADR-0012
  explicitly deferred replacing this per-instance store with "a shared store in
  AF-M8-02".
- **Auth** (Better Auth) and **tRPC mutations** had no limits at all.

`docs/architecture/security.md` §8 specifies what each surface's limit and key
should be (login 5/15min, reset 3/hr, webhook plan-based, tRPC burst cap), but
nothing implemented a common runtime for them.

Also binding: `docs/engineering/engineering_rules.md` says prefer the existing
stack over adding a dependency, and DONT-6 bans `eval`/`new Function` for user
expressions (not relevant here, but the precedent for "no hidden runtime").
There is no Redis/Upstash in the stack, and the deployment is single-instance.

## Decision

### 1. One `RateLimitStore` interface, one in-memory default

`src/lib/rate-limit/store.ts` defines:

```ts
interface BucketConfig { capacity: number; refillPerSecond: number; }
interface RateLimitDecision { allowed: boolean; retryAfterSeconds: number; remaining: number; limit: number; }
interface RateLimitStore { consume(key: string, config: BucketConfig): RateLimitDecision; }
```

`MemoryRateLimitStore` is the shipped default: a Map-backed token bucket with an
injectable `now()` for deterministic tests. A module singleton
`memoryRateLimiter` is exported from `src/lib/rate-limit/index.ts`.

The **interface is the seam for distribution**. A Redis/Postgres-backed store
implements the same `consume(key, config)`, and call sites do not change. That
multi-instance store is **not** built now: it is a documented follow-up, added
the moment deployments have more than one instance or a cache dependency is
justified. We do not add a cache/queue dependency today (engineering_rules §154).

### 2. All four surfaces consume the same store

- **Public API** (AF-M8-01): `src/features/api-keys/lib/rate-limit.ts` became a
  thin re-export of the shared store (`TokenBucketLimiter = MemoryRateLimitStore`,
  `API_BUCKET_BY_PLAN = PLAN_BUCKETS`, `resolveApiBucketLimits = resolvePlanBucket`),
  preserving AF-M8-01's exact behavior and its unit tests.
- **Webhook** (`/api/webhooks/[workflowId]/[path]`): the ad-hoc fixed counter was
  replaced by the plan-aware token bucket, keyed `webhook:{workflowId}:{path}`,
  bucket resolved from `Organization.plan`. `429` + `Retry-After` unchanged.
- **Auth** (Better Auth catch-all `src/app/api/auth/[...all]/route.ts`): wrapped
  with `tryRateLimited` (`src/lib/rate-limit/auth-route.ts`, `server-only`).
  Sign-in/sign-up `5/15min` keyed `{surface}:{ip}:{email}` (IPv4/IPv6/`XFF` first
  hop parsed), password reset `3/hr` keyed email only.
- **tRPC mutations**: a per-user burst cap (60 burst, 1/s refill) keyed
  `trpc:mutation:{userId}`, merged into the existing `protectedProcedure`
  middleware in `src/trpc/init.ts`. Queries are not throttled.

### 3. Plan buckets

`PLAN_BUCKETS` (FREE 60/1s, STARTER 600/10s, PRO 6000/100s,
ENTERPRISE 60000/1000s) are shared by the API and webhook surfaces, resolved via
`resolvePlanBucket`, which collapses an unknown/null plan to FREE per ADR-0010 —
the limit never widens on missing data.

## Consequences

- One rate-limiting concept to learn and test; the store's unit tests (via the
  AF-M8-01 limiter test through the re-export) cover the bucket algebra once.
- In-memory state is **per-process**: two replicas would each hold their own
  buckets and an attacker could spread traffic across them. This is acceptable
  for the current single-instance deployment and is the explicit reason the
  default is not "good enough forever"; the follow-up is a shared distributed
  `RateLimitStore`.
- Better Auth's built-in limiting was considered and rejected: it requires
  `secondaryStorage`/a DB model and couples the limits to an auth-specific
  store, whereas the wrapper keeps every surface on the one shared store.
- Follow-ups tracked in `tasks.md`/`progress.md` (AF-M8-02): distributed
  `RateLimitStore`, `X-RateLimit-*` headers on webhook responses, and
  `Retry-After`-aware client retries.
