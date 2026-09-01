/**
 * Execution retention policy (AF-M8-06).
 *
 * `Execution` and `NodeExecution` are the highest-growth tables in the system
 * — one row per run, and one row per node per run. Nothing removed them, so
 * they grew without bound, and `docs/architecture/security.md` §9's promise
 * that "execution IO is customer data ... retention is bounded" was not true.
 *
 * Retention runs in two stages rather than one, because the two things being
 * managed are different:
 *
 *   1. **IO redaction** at `ioRetentionDays` — `input`/`output` on both tables
 *      are set to NULL. This is the customer data and the overwhelming bulk of
 *      the bytes. The trace itself survives: status, order, timings, tokens,
 *      cost, model, error messages. So the monitoring and cost dashboards keep
 *      reporting truthfully over their full window while the payloads go.
 *   2. **Deletion** at `deleteAfterDays` — the `Execution` row is removed and
 *      `NodeExecution` follows by `onDelete: Cascade`.
 *
 * Collapsing them into a single delete would have forced a choice between
 * holding customer payloads for a year or throwing away a year of cost
 * history. Two stages needs neither.
 *
 * Like `src/lib/quotas.ts` this module is isomorphic and Prisma-free: it maps a
 * plan to a policy and a window to a cutoff. The DB work lives in
 * `src/features/executions/server/retention.ts`.
 */

import type { Plan } from "./quotas";

export interface RetentionPolicy {
  /** Age in days after which `input`/`output` payloads are nulled out. */
  ioRetentionDays: number;
  /**
   * Age in days after which the `Execution` row is deleted outright.
   * `Infinity` = never delete.
   */
  deleteAfterDays: number;
}

/**
 * The shortest delete window any plan may declare.
 *
 * The runner meters the monthly execution quota by COUNTING `Execution` rows
 * in the current calendar month (`src/lib/quotas.ts`). A delete window shorter
 * than a month would remove rows that are still being counted — the pruner
 * would silently refund quota, handing out paid capacity on a timer. 35 days
 * clears the longest possible calendar month with slack for a late sweep.
 *
 * `retention.test.ts` asserts every plan honours this floor, so lowering a
 * window below it fails the build rather than quietly leaking quota.
 */
export const QUOTA_SAFE_DELETE_FLOOR_DAYS = 35;

/**
 * Retention for an unspecified, null, or unrecognised plan. ADR-0010: an
 * unknown plan must never be granted MORE than FREE — and for retention,
 * "more" means keeping data longer.
 */
export const FREE_RETENTION: Readonly<RetentionPolicy> = Object.freeze({
  ioRetentionDays: 7,
  deleteAfterDays: QUOTA_SAFE_DELETE_FLOOR_DAYS,
});

/**
 * Plan -> retention window. These are a product call and live here as data,
 * not sprinkled through the pruner — the same shape as `PLAN_QUOTA_LIMITS`.
 */
export const PLAN_RETENTION: Readonly<Record<Plan, Readonly<RetentionPolicy>>> =
  Object.freeze({
    FREE: FREE_RETENTION,
    STARTER: Object.freeze({ ioRetentionDays: 30, deleteAfterDays: 90 }),
    PRO: Object.freeze({ ioRetentionDays: 90, deleteAfterDays: 365 }),
    ENTERPRISE: Object.freeze({
      ioRetentionDays: 365,
      // Enterprise contracts set their own retention; until one says
      // otherwise, never delete. IO redaction still applies.
      deleteAfterDays: Number.POSITIVE_INFINITY,
    }),
  });

const isPlan = (value: unknown): value is Plan =>
  typeof value === "string" && value in PLAN_RETENTION;

/** Resolve a plan value (possibly null/unknown) to its retention policy. */
export const resolveRetention = (
  plan: string | null | undefined,
): Readonly<RetentionPolicy> =>
  isPlan(plan) ? PLAN_RETENTION[plan] : FREE_RETENTION;

/**
 * The instant a window of `days` opened, relative to `now`. Rows older than
 * this are in scope for that stage.
 *
 * Returns `null` for an unlimited window — callers must read that as "prune
 * nothing", never as "prune everything", which is why it is not a Date.
 */
export const cutoffFor = (
  days: number,
  now: Date = new Date(),
): Date | null => {
  if (!Number.isFinite(days)) {
    return null;
  }
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
};
