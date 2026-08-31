import { describe, expect, it } from "vitest";
import {
  formatDayLabel,
  formatPercent,
  formatTokens,
  formatUsd,
} from "./format";

describe("formatUsd", () => {
  it("keeps sub-cent spend visible instead of rounding it to zero", () => {
    expect(formatUsd(0.0075)).toBe("$0.0075");
    expect(formatUsd(0.00001)).toBe("< $0.0001");
  });

  it("uses cents for amounts a person would read as money", () => {
    expect(formatUsd(412.899)).toBe("$412.90");
    expect(formatUsd(1)).toBe("$1.00");
  });

  it("renders zero and non-finite values as $0.00", () => {
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(Number.NaN)).toBe("$0.00");
  });
});

describe("formatTokens", () => {
  it("compacts thousands and millions", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(1_500)).toBe("1.5K");
    expect(formatTokens(2_400_000)).toBe("2.4M");
  });
});

describe("formatPercent", () => {
  it("renders a fraction as whole percent", () => {
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(0.666)).toBe("67%");
    expect(formatPercent(1)).toBe("100%");
  });
});

describe("formatDayLabel", () => {
  it("renders the UTC day, not the local one", () => {
    expect(formatDayLabel("2026-08-30")).toBe("Aug 30");
  });

  it("passes an unparseable value through unchanged", () => {
    expect(formatDayLabel("not-a-day")).toBe("not-a-day");
  });
});
