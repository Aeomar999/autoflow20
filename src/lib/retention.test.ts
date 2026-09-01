import { describe, expect, it } from "vitest";
import type { Plan } from "./quotas";
import {
  cutoffFor,
  FREE_RETENTION,
  PLAN_RETENTION,
  QUOTA_SAFE_DELETE_FLOOR_DAYS,
  resolveRetention,
} from "./retention";

const PLANS: Plan[] = ["FREE", "STARTER", "PRO", "ENTERPRISE"];

describe("resolveRetention", () => {
  it.each(PLANS)("returns the declared policy for %s", (plan) => {
    expect(resolveRetention(plan)).toBe(PLAN_RETENTION[plan]);
  });

  it.each([null, undefined, "", "LEGACY", "free"])(
    "collapses %p to FREE rather than granting more (ADR-0010)",
    (plan) => {
      expect(resolveRetention(plan as string | null)).toBe(FREE_RETENTION);
    },
  );
});

describe("retention policy shape", () => {
  it.each(PLANS)("redacts %s IO no later than it deletes the run", (plan) => {
    const { ioRetentionDays, deleteAfterDays } = PLAN_RETENTION[plan];
    expect(ioRetentionDays).toBeLessThanOrEqual(deleteAfterDays);
  });

  it.each(PLANS)("keeps %s runs past the quota window", (plan) => {
    // The runner meters the monthly quota by counting Execution rows in the
    // current calendar month. A delete window shorter than a month would
    // remove rows that are still being counted, silently REFUNDING quota to
    // the org - a paid feature handed out by the pruner. The floor is longer
    // than the longest possible month.
    expect(PLAN_RETENTION[plan].deleteAfterDays).toBeGreaterThanOrEqual(
      QUOTA_SAFE_DELETE_FLOOR_DAYS,
    );
  });

  it("has a floor longer than the longest calendar month", () => {
    expect(QUOTA_SAFE_DELETE_FLOOR_DAYS).toBeGreaterThan(31);
  });

  it.each(PLANS)("declares positive windows for %s", (plan) => {
    expect(PLAN_RETENTION[plan].ioRetentionDays).toBeGreaterThan(0);
    expect(PLAN_RETENTION[plan].deleteAfterDays).toBeGreaterThan(0);
  });

  it("gives a paid plan at least as long a window as FREE", () => {
    for (const plan of ["STARTER", "PRO", "ENTERPRISE"] as Plan[]) {
      expect(PLAN_RETENTION[plan].ioRetentionDays).toBeGreaterThanOrEqual(
        FREE_RETENTION.ioRetentionDays,
      );
      expect(PLAN_RETENTION[plan].deleteAfterDays).toBeGreaterThanOrEqual(
        FREE_RETENTION.deleteAfterDays,
      );
    }
  });
});

describe("cutoffFor", () => {
  const now = new Date("2026-09-01T12:00:00.000Z");

  it("returns the instant the window opened", () => {
    expect(cutoffFor(7, now)?.toISOString()).toBe("2026-08-25T12:00:00.000Z");
  });

  it("returns null for an unlimited window so nothing is ever pruned", () => {
    expect(cutoffFor(Number.POSITIVE_INFINITY, now)).toBeNull();
  });

  it("does not mutate the reference date", () => {
    const reference = new Date(now);
    cutoffFor(30, reference);
    expect(reference.toISOString()).toBe(now.toISOString());
  });

  it("crosses a month boundary correctly", () => {
    expect(cutoffFor(35, new Date("2026-03-05T00:00:00.000Z"))).toEqual(
      new Date("2026-01-29T00:00:00.000Z"),
    );
  });
});
