import { describe, expect, it } from "vitest";
import { EXPENSIVE_COST_SHARE, isExpensiveCostShare } from "./cost-share";

/**
 * AF-UX-02 — the "expensive node" threshold rules.
 *
 * The plan calls for highlighting nodes above 10% of the run's total cost. The
 * interesting behaviour is the exact bound (strictly greater than, not greater
 * or equal) and the guards: a $0 total can never make a node expensive, and
 * zero-cost nodes must never be highlighted no matter what the run cost.
 */
describe("isExpensiveCostShare (AF-UX-02)", () => {
  it("flags a node costing more than the share of the run total", () => {
    expect(isExpensiveCostShare(0.2, 1)).toBe(true);
    expect(isExpensiveCostShare(0.3, 1)).toBe(true);
  });

  it("does not flag a node at the exact share bound (strictly greater than)", () => {
    expect(isExpensiveCostShare(0.1, 1)).toBe(false);
    expect(isExpensiveCostShare(EXPENSIVE_COST_SHARE, 1)).toBe(false);
  });

  it("does not flag a node below the share", () => {
    expect(isExpensiveCostShare(0.05, 1)).toBe(false);
    expect(isExpensiveCostShare(0.09, 1)).toBe(false);
  });

  it("never flags a zero-cost node", () => {
    expect(isExpensiveCostShare(0, 1)).toBe(false);
  });

  it("treats null and undefined cost as not expensive", () => {
    expect(isExpensiveCostShare(null, 1)).toBe(false);
    expect(isExpensiveCostShare(undefined, 1)).toBe(false);
  });

  it("never flags when the run total is zero, negative, or non-finite", () => {
    expect(isExpensiveCostShare(0.5, 0)).toBe(false);
    expect(isExpensiveCostShare(0.5, -1)).toBe(false);
    expect(isExpensiveCostShare(0.5, Number.NaN)).toBe(false);
    expect(isExpensiveCostShare(0.5, Number.POSITIVE_INFINITY)).toBe(false);
  });

  it("treats non-finite cost as not expensive", () => {
    expect(isExpensiveCostShare(Number.NaN, 1)).toBe(false);
    expect(isExpensiveCostShare(Number.POSITIVE_INFINITY, 1)).toBe(false);
  });
});
