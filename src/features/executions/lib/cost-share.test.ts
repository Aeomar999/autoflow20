import { describe, expect, it } from "vitest";

import { EXPENSIVE_COST_SHARE, isExpensiveCostShare } from "./cost-share";

const TOTAL = 100;

describe("isExpensiveCostShare", () => {
  it("flags a node strictly above the expense share", () => {
    expect(
      isExpensiveCostShare(TOTAL * EXPENSIVE_COST_SHARE + 0.01, TOTAL),
    ).toBe(true);
  });

  it("does not flag a node exactly on the expense share boundary", () => {
    expect(isExpensiveCostShare(TOTAL * EXPENSIVE_COST_SHARE, TOTAL)).toBe(
      false,
    );
  });

  it("does not flag a node below the expense share", () => {
    expect(isExpensiveCostShare(5, TOTAL)).toBe(false);
  });

  it("never flags a zero-cost node", () => {
    expect(isExpensiveCostShare(0, TOTAL)).toBe(false);
  });

  it("never flags a missing or undefined cost", () => {
    expect(isExpensiveCostShare(null, TOTAL)).toBe(false);
    expect(isExpensiveCostShare(undefined, TOTAL)).toBe(false);
  });

  it("never flags when the run total is zero or negative", () => {
    expect(isExpensiveCostShare(15, 0)).toBe(false);
    expect(isExpensiveCostShare(15, -1)).toBe(false);
  });

  it("never flags non-finite costs or totals", () => {
    expect(isExpensiveCostShare(Number.NaN, TOTAL)).toBe(false);
    expect(isExpensiveCostShare(Number.POSITIVE_INFINITY, TOTAL)).toBe(false);
    expect(isExpensiveCostShare(15, Number.NaN)).toBe(false);
    expect(isExpensiveCostShare(15, Number.POSITIVE_INFINITY)).toBe(false);
  });
});
