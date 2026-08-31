import { describe, expect, it } from "vitest";
import {
  COUNTABLE_EXECUTION_STATUSES,
  evaluateExecutionQuota,
  FREE_PLAN_LIMIT,
  isMeteredRun,
  PLAN_QUOTA_LIMITS,
  QUOTA_EXCEEDED_STATUS,
  quotaBreachMessage,
  resolvePlanLimits,
} from "./quotas";

describe("resolvePlanLimits", () => {
  it("maps each known plan to its configured limit", () => {
    expect(resolvePlanLimits("FREE").monthlyExecutions).toBe(
      FREE_PLAN_LIMIT.monthlyExecutions,
    );
    expect(resolvePlanLimits("STARTER").monthlyExecutions).toBe(1_000);
    expect(resolvePlanLimits("PRO").monthlyExecutions).toBe(Infinity);
    expect(resolvePlanLimits("ENTERPRISE").monthlyExecutions).toBe(Infinity);
  });

  it("collapses null/undefined/unknown plans to FREE so they can never widen access (ADR-0010)", () => {
    expect(resolvePlanLimits(null).monthlyExecutions).toBe(
      FREE_PLAN_LIMIT.monthlyExecutions,
    );
    expect(resolvePlanLimits(undefined).monthlyExecutions).toBe(
      FREE_PLAN_LIMIT.monthlyExecutions,
    );
    expect(resolvePlanLimits("LEGACY" as never).monthlyExecutions).toBe(
      FREE_PLAN_LIMIT.monthlyExecutions,
    );
  });
});

describe("evaluateExecutionQuota", () => {
  it("allows a FREE org under the monthly cap", () => {
    const d = evaluateExecutionQuota({
      plan: "FREE",
      currentMonthExecutions: 50,
    });
    expect(d.allowed).toBe(true);
    expect(d.exceeded).toBe(false);
    expect(d.current).toBe(50);
    expect(d.limit).toBe(FREE_PLAN_LIMIT.monthlyExecutions);
    expect(d.remaining).toBe(FREE_PLAN_LIMIT.monthlyExecutions - 50);
  });

  it("blocks a FREE org on the run that would exceed the cap", () => {
    const d = evaluateExecutionQuota({
      plan: "FREE",
      currentMonthExecutions: 100,
    });
    expect(d.allowed).toBe(false);
    expect(d.exceeded).toBe(true);
    expect(d.remaining).toBe(0);
    expect(d.suggestedStatus).toBe(QUOTA_EXCEEDED_STATUS);
  });

  it("blocks a STARTER org past its 1000-run cap", () => {
    const d = evaluateExecutionQuota({
      plan: "STARTER",
      currentMonthExecutions: 1_000,
    });
    expect(d.exceeded).toBe(true);
    expect(d.suggestedStatus).toBe(QUOTA_EXCEEDED_STATUS);
  });

  it("never blocks PRO / ENTERPRISE (unlimited)", () => {
    for (const plan of ["PRO", "ENTERPRISE"] as const) {
      const d = evaluateExecutionQuota({
        plan,
        currentMonthExecutions: 9_999_999,
      });
      expect(d.allowed).toBe(true);
      expect(d.exceeded).toBe(false);
      expect(d.limit).toBe(Infinity);
      expect(d.remaining).toBe(Infinity);
    }
  });

  it("reports negative remaining once the quota is already well past the limit", () => {
    const d = evaluateExecutionQuota({
      plan: "FREE",
      currentMonthExecutions: 120,
    });
    expect(d.exceeded).toBe(true);
    expect(d.remaining).toBe(-20);
  });

  it("clamps a negative/NaN count to zero instead of granting access from a corrupt figure", () => {
    const neg = evaluateExecutionQuota({
      plan: "FREE",
      currentMonthExecutions: -5,
    });
    expect(neg.current).toBe(0);
    expect(neg.allowed).toBe(true);

    const nanD = evaluateExecutionQuota({
      plan: "FREE",
      currentMonthExecutions: Number.NaN,
    });
    expect(nanD.current).toBe(0);
    expect(nanD.allowed).toBe(true);
  });

  it("honours an explicit limit override (tests / dynamic plans)", () => {
    const d = evaluateExecutionQuota({
      plan: "FREE",
      currentMonthExecutions: 10,
      limitOverride: 10,
    });
    expect(d.exceeded).toBe(true);
    expect(d.limit).toBe(10);
  });

  it("exposes the configured table for the quota UI", () => {
    expect(Object.keys(PLAN_QUOTA_LIMITS).sort()).toEqual([
      "ENTERPRISE",
      "FREE",
      "PRO",
      "STARTER",
    ]);
  });
});

describe("isMeteredRun", () => {
  it("meters a default (PRODUCTION) run", () => {
    expect(isMeteredRun({ mode: "PRODUCTION", e2eServer: false })).toBe(true);
  });

  it("treats a missing mode as metered (conservative default)", () => {
    expect(isMeteredRun({ mode: undefined, e2eServer: false })).toBe(true);
    expect(isMeteredRun({ mode: null, e2eServer: false })).toBe(true);
  });

  it("never meters a TEST-mode run", () => {
    expect(isMeteredRun({ mode: "TEST", e2eServer: false })).toBe(false);
  });

  it("never meters under the E2E_SERVER bypass", () => {
    expect(isMeteredRun({ mode: "PRODUCTION", e2eServer: true })).toBe(false);
    expect(isMeteredRun({ mode: "TEST", e2eServer: true })).toBe(false);
  });
});

describe("COUNTABLE_EXECUTION_STATUSES", () => {
  it("counts every terminal outcome except quota refusals", () => {
    expect([...COUNTABLE_EXECUTION_STATUSES].sort()).toEqual(
      ["SUCCESS", "FAILED", "CANCELLED", "TIMED_OUT"].sort(),
    );
  });

  it("excludes RUNNING (in-flight) and QUOTA_EXCEEDED (a refusal must not tax the quota it was refused for)", () => {
    expect(COUNTABLE_EXECUTION_STATUSES).not.toContain("RUNNING");
    expect(COUNTABLE_EXECUTION_STATUSES).not.toContain(QUOTA_EXCEEDED_STATUS);
  });
});

describe("quotaBreachMessage", () => {
  it("names the plan and the exact allowance", () => {
    const message = quotaBreachMessage("FREE", 100);
    expect(message).toContain("FREE");
    expect(message).toContain("100 production runs");
  });

  it("uses singular wording for a 1-run plan", () => {
    const message = quotaBreachMessage("STARTER", 1);
    expect(message).toContain("1 production run");
    expect(message).not.toContain("runs per calendar month");
  });

  it("collapses an unknown/null plan to FREE instead of leaking a raw string", () => {
    expect(quotaBreachMessage(null, 100)).toContain("FREE");
    expect(quotaBreachMessage("LEGACY" as never, 100)).toContain("FREE");
  });
});
