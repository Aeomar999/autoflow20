import { describe, expect, it } from "vitest";
import {
  COST_PERIOD_DAYS,
  DEFAULT_COST_PERIOD_DAYS,
  normalizeCostPeriodDays,
} from "./params";

describe("normalizeCostPeriodDays", () => {
  it("passes through every window the picker offers", () => {
    for (const days of COST_PERIOD_DAYS) {
      expect(normalizeCostPeriodDays(days)).toBe(days);
    }
  });

  it("accepts any whole window the router accepts", () => {
    expect(normalizeCostPeriodDays(1)).toBe(1);
    expect(normalizeCostPeriodDays(45)).toBe(45);
    expect(normalizeCostPeriodDays(90)).toBe(90);
  });

  it("falls back to the default rather than failing on a hand-edited URL", () => {
    expect(normalizeCostPeriodDays(0)).toBe(DEFAULT_COST_PERIOD_DAYS);
    expect(normalizeCostPeriodDays(-7)).toBe(DEFAULT_COST_PERIOD_DAYS);
    expect(normalizeCostPeriodDays(365)).toBe(DEFAULT_COST_PERIOD_DAYS);
    expect(normalizeCostPeriodDays(7.5)).toBe(DEFAULT_COST_PERIOD_DAYS);
    expect(normalizeCostPeriodDays(Number.NaN)).toBe(DEFAULT_COST_PERIOD_DAYS);
  });
});
