import { describe, expect, it } from "vitest";

import { formatCount, formatDuration, pluralize } from "./format";

describe("formatDuration", () => {
  it("renders an em dash for a missing measurement", () => {
    // Null is "nothing completed yet", which is not the same as zero — the
    // dashboard must not print "0ms" for a workspace that has never run.
    expect(formatDuration(null)).toBe("—");
  });

  it("keeps sub-second durations in milliseconds", () => {
    expect(formatDuration(12)).toBe("12ms");
    expect(formatDuration(999)).toBe("999ms");
  });

  it("switches to seconds at a second", () => {
    expect(formatDuration(1000)).toBe("1.0s");
    expect(formatDuration(45_600)).toBe("45.6s");
  });

  it("switches to minutes at a minute", () => {
    expect(formatDuration(60_000)).toBe("1m 0s");
    expect(formatDuration(95_000)).toBe("1m 35s");
  });

  it("survives a non-finite measurement", () => {
    expect(formatDuration(Number.NaN)).toBe("—");
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

describe("formatCount", () => {
  it("groups thousands", () => {
    expect(formatCount(1234)).toBe("1,234");
  });

  it("collapses a non-finite count to zero rather than printing NaN", () => {
    expect(formatCount(Number.NaN)).toBe("0");
  });
});

describe("pluralize", () => {
  it("uses the singular for exactly one", () => {
    expect(pluralize(1, "run")).toBe("1 run");
  });

  it("uses the plural for zero and many", () => {
    expect(pluralize(0, "run")).toBe("0 runs");
    expect(pluralize(4, "run")).toBe("4 runs");
  });

  it("accepts an irregular plural", () => {
    expect(pluralize(2, "entry", "entries")).toBe("2 entries");
  });
});
