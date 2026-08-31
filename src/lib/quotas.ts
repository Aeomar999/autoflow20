/**
 * Quota resolution for AF-M7-04 (per-plan execution + AI-spend limits).
 *
 * Adr-0010: the source of truth for "what plan is this org on" is the
 * org-level `Organization.plan` enum, resolved on `ctx.org`. This module is
 * isomorphic + pure by design (mirrors the `Role` string-union pattern in
 * `src/lib/rbac.ts`): it takes a plan and a current-month count and returns a
 * decision. The DB-backed caller (`AF-M7-pre-1` + the runner) supplies the
 * count; nothing here touches Prisma, so the enforcement logic is unit-testable
 * in isolation.
 *
 * Design decisions (recorded in tasks.md M7 addenda, 2026-08-30):
 * 1. On quota breach the run is HARD-FAILED with a distinguishable
 *    `QUOTA_EXCEEDED` status, never silently dropped.
 * 2. Metering source is Postgres `Execution` rows (transactional, enforcement);
 *    Polar carries billing/usage visibility only.
 * 3. First quota PR enforces execution-count only; AI-spend consumes
 *    `Execution.costUsd` once AF-M5-02 wires cost capture into the runner.
 */

/** The org plan enum values. Kept as a string union (like `Role`) so this
 * module stays isomorphic and Prisma-free. Must match `prisma/schema.prisma`
 * `enum Plan { FREE STARTER PRO ENTERPRISE }`. */
export type Plan = "FREE" | "STARTER" | "PRO" | "ENTERPRISE";

/** Execution row status used to record a quota-breach run. Kept as a string
 * so this module stays isomorphic; matches the Prisma `ExecutionStatus` value
 * "QUOTA_EXCEEDED" (added in AF-M7-04). */
export const QUOTA_EXCEEDED_STATUS = "QUOTA_EXCEEDED" as const;

/** Terminal statuses that consume the monthly execution quota. `RUNNING`
 * (in-flight, excluded) and the `QUOTA_EXCEEDED` refusals themselves (which
 * must not tax the quota they were refused for) are intentionally absent.
 * Mirrors Prisma `ExecutionStatus`; the runner casts to the generated enum. */
export const COUNTABLE_EXECUTION_STATUSES = [
  "SUCCESS",
  "FAILED",
  "CANCELLED",
  "TIMED_OUT",
] as const;

/** A monthly execution-count limit per plan. `Infinity` = unlimited. */
export interface PlanExecutionLimit {
  /** Maximum production runs per calendar month. `Infinity` = no cap. */
  monthlyExecutions: number;
  /** Optional monthly AI-spend cap in USD (deferred; consumed by AF-M5-02
   * cost capture). Omitted/undefined = not enforced yet. */
  monthlyAiSpendUsd?: number;
}

/** Default limits for an unspecified/null/unknown plan. Adr-0010: unknown
 * plans must not grant MORE access than FREE. */
export const FREE_PLAN_LIMIT: Readonly<PlanExecutionLimit> = Object.freeze({
  monthlyExecutions: 100,
});

/** Plan -> monthly execution allowance. Placeholder defaults; final numbers
 * are a product call and live here as data, not sprinkled through code. */
export const PLAN_QUOTA_LIMITS: Readonly<
  Record<Plan, Readonly<PlanExecutionLimit>>
> = Object.freeze({
  FREE: FREE_PLAN_LIMIT,
  STARTER: Object.freeze({ monthlyExecutions: 1_000 }),
  PRO: Object.freeze({ monthlyExecutions: Infinity }),
  ENTERPRISE: Object.freeze({ monthlyExecutions: Infinity }),
});

/** Output of an execution-quota evaluation. */
export interface ExecutionQuotaDecision {
  /** True when the run may proceed. */
  allowed: boolean;
  /** True when `allowed === false` *because of the quota*, so callers can
   * distinguish a quota breach from any other refusal. */
  exceeded: boolean;
  /** The org's current-month execution count used for this check. */
  current: number;
  /** The plan's monthly execution limit. */
  limit: number;
  /** The status the runner should write for an over-limit run. Only valid
   * when `exceeded === true`. */
  suggestedStatus: typeof QUOTA_EXCEEDED_STATUS;
  /** Remaining runs this month. Negative when the quota is already past the
   * limit (drives "surfaced before the limit" UI). */
  remaining: number;
}

/** Resolve the limits for an org plan. Unknown/null plans collapse to FREE so
 * an unset or future plan value can never widen access (Adr-0010). */
export function resolvePlanLimits(
  plan: Plan | string | null | undefined,
): Readonly<PlanExecutionLimit> {
  if (plan && plan in PLAN_QUOTA_LIMITS) {
    return PLAN_QUOTA_LIMITS[plan as Plan];
  }
  return FREE_PLAN_LIMIT;
}

/**
 * Pure evaluation of an execution-count quota.
 *
 * @param plan - org plan (resolved on `ctx.org` by the caller).
 * @param currentMonthExecutions - non-negative count of the org's production
 *   executions this calendar month.
 * @param limitOverride - optional explicit limit for tests / dynamic plans.
 */
export function evaluateExecutionQuota(params: {
  plan: Plan | string | null | undefined;
  currentMonthExecutions: number;
  limitOverride?: number | undefined;
}): ExecutionQuotaDecision {
  const count = Math.max(0, Math.floor(params.currentMonthExecutions || 0));
  const limits = resolvePlanLimits(params.plan);
  const rawLimit = params.limitOverride ?? limits.monthlyExecutions;
  const limit = rawLimit === Infinity ? Infinity : Math.max(0, rawLimit);

  const allowed = limit === Infinity || count < limit;
  const exceeded = !allowed;

  return {
    allowed,
    exceeded,
    current: count,
    limit,
    suggestedStatus: QUOTA_EXCEEDED_STATUS,
    remaining: limit === Infinity ? Infinity : limit - count,
  };
}

/**
 * Whether a run should consume the monthly execution quota.
 *
 * TEST-mode runs (canvas test runs, AF-M2-08) and runs admitted under the
 * explicit `E2E_SERVER === "1"` bypass never meter; everything else (default
 * PRODUCTION, channel/trigger runs) is metered. Mirrors the `E2E_SERVER`
 * guard on `src/trpc/init.ts:52` so the run gate can never be bypassed in
 * production by accident.
 */
export function isMeteredRun(params: {
  mode: string | null | undefined;
  e2eServer: boolean;
}): boolean {
  return params.mode !== "TEST" && !params.e2eServer;
}

/** Human-readable message recorded on a `QUOTA_EXCEEDED` run. `limit` is
 * always finite for an exceeded run — the evaluator never blocks an unlimited
 * plan — so the "allows N runs" wording is safe to branch on `limit === 1`. */
export function quotaBreachMessage(
  plan: Plan | string | null | undefined,
  limit: number,
): string {
  const label = plan && plan in PLAN_QUOTA_LIMITS ? (plan as Plan) : "FREE";
  const limitLabel = limit === Infinity ? "an unlimited" : `${limit}`;
  const noun =
    limit === 1 ? "1 production run" : `${limitLabel} production runs`;
  return `Monthly execution quota exceeded: the ${label} plan allows ${noun} per calendar month. Upgrade your plan or wait for the next month to run this workflow again.`;
}
