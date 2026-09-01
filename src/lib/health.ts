/**
 * Health reporting (AF-M8-07).
 *
 * The vocabulary the `/api/health` endpoint and the public `/status` page both
 * speak. Kept isomorphic and dependency-free: the probes that actually touch
 * Postgres live in `src/features/health/server/checks.ts`, so the aggregation
 * rules - which are the part with the sharp edges - are unit-testable without
 * a database.
 *
 * Two rules here are deliberate and easy to get backwards:
 *
 * - A probe that throws is **down**, never "unknown" and never skipped. A
 *   health check that fails open reports green while the service burns.
 * - An empty check list is **down**. No evidence of health is not evidence of
 *   health; an empty list means the checks did not run.
 */

export type HealthState = "ok" | "degraded" | "down";

export interface HealthCheck {
  /** Stable identifier, safe to expose publicly. Never an error message. */
  name: string;
  state: HealthState;
}

export interface HealthReport {
  status: HealthState;
  checks: HealthCheck[];
}

/**
 * HTTP status per state.
 *
 * `degraded` is deliberately 200. The service is still serving requests, and
 * returning 503 would make a load balancer pull an instance that is doing
 * useful work - turning a partial outage into a total one. The distinction is
 * carried in the body for the status page and for alerting, not in the code an
 * infrastructure component reacts to.
 */
export const HEALTH_HTTP_STATUS: Readonly<Record<HealthState, number>> =
  Object.freeze({
    ok: 200,
    degraded: 200,
    down: 503,
  });

/** Worst-first, so `Math.max` over the index picks the worst state present. */
const SEVERITY: readonly HealthState[] = ["ok", "degraded", "down"];

/** Reduce checks to a single status: the worst state any check reports. */
export const summarizeHealth = (checks: HealthCheck[]): HealthReport => {
  if (checks.length === 0) {
    return { status: "down", checks };
  }

  const worst = checks.reduce(
    (acc, check) => Math.max(acc, SEVERITY.indexOf(check.state)),
    0,
  );

  return { status: SEVERITY[worst], checks };
};

/** Default probe budget. A health check that hangs is a health check failure. */
export const HEALTH_CHECK_TIMEOUT_MS = 2_000;

/**
 * Run one probe, converting a throw or a hang into `down`.
 *
 * The thrown error is deliberately not carried into the result: this feeds a
 * public endpoint, and a Postgres error string names hosts, ports, roles, and
 * sometimes credentials. The error is the caller's to log server-side.
 */
export const runCheck = async (
  name: string,
  probe: () => Promise<HealthState>,
  options: { timeoutMs?: number } = {},
): Promise<HealthCheck> => {
  const timeoutMs = options.timeoutMs ?? HEALTH_CHECK_TIMEOUT_MS;

  try {
    const state = await Promise.race([
      probe(),
      new Promise<HealthState>((_, reject) =>
        setTimeout(
          () => reject(new Error(`health check "${name}" timed out`)),
          timeoutMs,
        ),
      ),
    ]);
    return { name, state };
  } catch {
    return { name, state: "down" };
  }
};
