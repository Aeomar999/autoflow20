import type { NextRequest } from "next/server";
import { checkHealth } from "@/features/health/server/checks";
import { HEALTH_HTTP_STATUS } from "@/lib/health";
import { memoryRateLimiter } from "@/lib/rate-limit";
import { clientIp } from "@/lib/rate-limit/auth-route";

/**
 * Machine-readable health endpoint (AF-M8-07).
 *
 * This is what an uptime monitor polls and what a load balancer reads. It is
 * unauthenticated by necessity - a health check that needs a session cannot
 * tell you the service is unreachable - which shapes three decisions:
 *
 * 1. **The body carries no diagnostics.** Check names and states only. A
 *    Postgres error string names hosts, ports, and roles; `checkHealth` logs
 *    the detail server-side and returns a verdict.
 * 2. **It is rate limited.** Each probe runs real queries, so an open endpoint
 *    that does database work is a free amplification primitive. Reuses the
 *    shared limiter from AF-M8-02 rather than inventing a second scheme.
 * 3. **`degraded` still returns 200.** See `HEALTH_HTTP_STATUS` - a 503 would
 *    make a load balancer evict an instance that is still doing useful work.
 */

/** Health must reflect this instant, never a cached render. */
export const dynamic = "force-dynamic";

/**
 * Generous enough for a monitor polling every 10s from several regions, tight
 * enough that the endpoint is not a free way to make us query Postgres.
 */
const HEALTH_BUCKET = { capacity: 30, refillPerSecond: 1 } as const;

export async function GET(request: NextRequest) {
  const decision = memoryRateLimiter.consume(
    `health:${clientIp(request.headers)}`,
    HEALTH_BUCKET,
  );

  if (!decision.allowed) {
    return new Response(null, {
      status: 429,
      headers: { "retry-after": String(decision.retryAfterSeconds) },
    });
  }

  const report = await checkHealth();

  return Response.json(report, {
    status: HEALTH_HTTP_STATUS[report.status],
    headers: { "cache-control": "no-store" },
  });
}
