import "server-only";
import prisma from "@/lib/db";
import {
  type HealthReport,
  type HealthState,
  runCheck,
  summarizeHealth,
} from "@/lib/health";
import { logger } from "@/lib/logger";

/**
 * The probes behind `/api/health` and `/status` (AF-M8-07).
 *
 * Two checks, chosen because each maps to a runbook entry rather than to a
 * component we happen to be able to ping:
 *
 * - `database` - if Postgres is unreachable nothing works. Runbook F2.
 * - `runner` - executions that started long ago and never reached a terminal
 *   status. This is what an engine outage actually looks like from the
 *   outside: the app keeps serving, runs keep being accepted, and none of them
 *   finish. Runbook F1. Nothing else in the system would notice.
 *
 * Deliberately absent: a probe that calls Inngest, an AI provider, or any
 * other third party. A health endpoint that makes outbound calls converts
 * someone else's outage into our own latency, and it hands an anonymous caller
 * a way to make us generate traffic.
 */

/**
 * A run older than this that is still `RUNNING` is treated as stuck. Well
 * above any legitimate workflow: the per-request egress timeout is 60s at the
 * ceiling, and a long chain of retrying nodes still lands far inside this.
 */
export const STUCK_RUN_THRESHOLD_MS = 30 * 60 * 1000;

/** Stuck runs tolerated before the runner is called degraded. */
export const STUCK_RUN_DEGRADED_THRESHOLD = 1;

/** Stuck runs that mean the engine is not processing at all. */
export const STUCK_RUN_DOWN_THRESHOLD = 25;

/**
 * The database probe gets a longer budget than the generic default.
 *
 * The first query in a cold process pays for pool establishment and the TLS
 * handshake on top of the round trip. At the 2s default this reported a false
 * `down` on the first request after a deploy - a status page announcing a
 * major outage because a connection pool had not warmed up yet. A health check
 * that cries wolf on every cold start is worse than no health check, because
 * people learn to ignore it. 5s is still far inside any monitor interval.
 */
export const DATABASE_CHECK_TIMEOUT_MS = 5_000;

const databaseProbe = async (): Promise<HealthState> => {
  await prisma.$queryRaw`SELECT 1`;
  return "ok";
};

/**
 * Count runs that started long enough ago that they cannot still be legitimate
 * and never reached a terminal status.
 *
 * A handful means something crashed mid-run; a wall of them means the queue is
 * not being drained, which is the failure the engine cannot self-report.
 */
const runnerProbe = async (now: Date): Promise<HealthState> => {
  const stuck = await prisma.execution.count({
    where: {
      status: "RUNNING",
      startedAt: { lt: new Date(now.getTime() - STUCK_RUN_THRESHOLD_MS) },
    },
  });

  if (stuck >= STUCK_RUN_DOWN_THRESHOLD) {
    return "down";
  }
  if (stuck >= STUCK_RUN_DEGRADED_THRESHOLD) {
    return "degraded";
  }
  return "ok";
};

/**
 * Run every probe and summarise. Never throws: a probe that fails is a `down`
 * check, so the caller always has a report to serve.
 *
 * Failures are logged here rather than returned, because the report is public
 * and a database error string names hosts, ports, and roles.
 */
export const checkHealth = async (
  now: Date = new Date(),
): Promise<HealthReport> => {
  const checks = await Promise.all([
    runCheck("database", databaseProbe, {
      timeoutMs: DATABASE_CHECK_TIMEOUT_MS,
    }),
    runCheck("runner", () => runnerProbe(now)),
  ]);

  const report = summarizeHealth(checks);

  if (report.status !== "ok") {
    logger.warn("health check not ok", {
      status: report.status,
      checks: report.checks,
    });
  }

  return report;
};
