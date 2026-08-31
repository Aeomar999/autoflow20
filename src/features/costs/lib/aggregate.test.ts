import { describe, expect, it } from "vitest";
import { fillDailySeries, roundUsd, shareOfTotal, toIsoDay } from "./aggregate";

describe("roundUsd", () => {
  it("keeps micro-dollar precision", () => {
    expect(roundUsd(0.0000004)).toBe(0);
    expect(roundUsd(0.0000006)).toBe(0.000001);
    expect(roundUsd(12.3456789)).toBe(12.345679);
  });

  it("returns 0 for non-finite input rather than propagating NaN", () => {
    expect(roundUsd(Number.NaN)).toBe(0);
    expect(roundUsd(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("toIsoDay", () => {
  it("uses the UTC calendar day, not the local one", () => {
    expect(toIsoDay(new Date("2026-08-30T23:30:00Z"))).toBe("2026-08-30");
    expect(toIsoDay(new Date("2026-08-31T00:30:00Z"))).toBe("2026-08-31");
  });
});

describe("fillDailySeries", () => {
  const now = new Date("2026-08-30T15:00:00Z");

  it("returns one ascending point per day in the window", () => {
    const series = fillDailySeries([], 7, now);

    expect(series).toHaveLength(7);
    expect(series[0].date).toBe("2026-08-24");
    expect(series[6].date).toBe("2026-08-30");
  });

  it("zero-fills days with no runs instead of leaving gaps", () => {
    const series = fillDailySeries(
      [
        {
          day: new Date("2026-08-30T00:00:00Z"),
          costUsd: 1.5,
          runs: 3,
          tokensIn: 100,
          tokensOut: 50,
        },
      ],
      3,
      now,
    );

    expect(series.map((point) => point.date)).toEqual([
      "2026-08-28",
      "2026-08-29",
      "2026-08-30",
    ]);
    expect(series[0]).toEqual({
      date: "2026-08-28",
      costUsd: 0,
      runs: 0,
      tokensIn: 0,
      tokensOut: 0,
    });
    expect(series[2]).toEqual({
      date: "2026-08-30",
      costUsd: 1.5,
      runs: 3,
      tokensIn: 100,
      tokensOut: 50,
    });
  });

  it("rounds each day's spend to micro-dollars", () => {
    const series = fillDailySeries(
      [
        {
          day: new Date("2026-08-30T00:00:00Z"),
          costUsd: 0.12345678,
          runs: 1,
          tokensIn: 0,
          tokensOut: 0,
        },
      ],
      1,
      now,
    );

    expect(series[0].costUsd).toBe(0.123457);
  });

  it("ignores rows outside the window", () => {
    const series = fillDailySeries(
      [
        {
          day: new Date("2026-01-01T00:00:00Z"),
          costUsd: 99,
          runs: 9,
          tokensIn: 0,
          tokensOut: 0,
        },
      ],
      2,
      now,
    );

    expect(series.every((point) => point.costUsd === 0)).toBe(true);
  });
});

describe("shareOfTotal", () => {
  it("returns the fraction, clamped, and 0 for an empty total", () => {
    expect(shareOfTotal(1, 4)).toBe(0.25);
    expect(shareOfTotal(5, 4)).toBe(1);
    expect(shareOfTotal(-1, 4)).toBe(0);
    expect(shareOfTotal(1, 0)).toBe(0);
    expect(shareOfTotal(Number.NaN, 4)).toBe(0);
  });
});
