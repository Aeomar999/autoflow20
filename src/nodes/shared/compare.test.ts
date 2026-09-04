import { describe, expect, it } from "vitest";
import { ComparisonTypeError, compareTyped, UNARY_OPERATORS } from "./compare";

const cmp = (
  left: string,
  operator: Parameters<typeof compareTyped>[0]["operator"],
  right = "",
  type: Parameters<typeof compareTyped>[0]["type"] = "string",
) => compareTyped({ left, operator, right, type });

describe("compareTyped (AF-M10-10)", () => {
  it('does not treat the string "false" as truthy', () => {
    // The failure this exists to prevent: `CONDITION` compares rendered
    // strings, so `{{item.ok}}` where ok is boolean false renders "false",
    // and "keep the ones where ok is true" quietly keeps everything.
    expect(cmp("false", "equals", "true", "boolean")).toBe(false);
    expect(cmp("false", "is_true")).toBe(false);
    expect(cmp("true", "is_true")).toBe(true);
    expect(cmp("false", "is_false")).toBe(true);
  });

  it("compares numbers numerically, not lexically", () => {
    // "9" > "10" as strings. As numbers it is not.
    expect(cmp("9", "gt", "10", "number")).toBe(false);
    expect(cmp("10", "gt", "9", "number")).toBe(true);
    expect(cmp("10.50", "equals", "10.5", "number")).toBe(true);
  });

  it("keeps strings lexical when the author says string", () => {
    expect(cmp("10", "equals", "10.0", "string")).toBe(false);
  });

  it("compares dates chronologically", () => {
    expect(
      cmp("2026-09-03T00:00:00Z", "gt", "2026-09-01T00:00:00Z", "date"),
    ).toBe(true);
    expect(
      cmp("2026-09-01T00:00:00Z", "gte", "2026-09-01T00:00:00Z", "date"),
    ).toBe(true);
  });

  it("refuses a value that is not the declared type", () => {
    // Strict, never coercing (AF-M9-08's rule). A silent NaN comparison
    // returns false for everything, which reads as "nothing matched".
    expect(() => cmp("banana", "gt", "3", "number")).toThrow(
      ComparisonTypeError,
    );
    expect(() => cmp("yes", "equals", "true", "boolean")).toThrow(
      ComparisonTypeError,
    );
    expect(() => cmp("not a date", "gt", "2026-01-01", "date")).toThrow(
      ComparisonTypeError,
    );
  });

  it("names which side was wrong", () => {
    expect(() => cmp("3", "gt", "banana", "number")).toThrow(/right-hand/);
    expect(() => cmp("banana", "gt", "3", "number")).toThrow(/left-hand/);
  });

  it("treats an absent value as not-matching for ordering, not as an error", () => {
    // "keep rows whose amount is over 100" should skip a row with no amount,
    // not fail the run on the first blank cell.
    expect(cmp("", "gt", "100", "number")).toBe(false);
    expect(cmp("", "lt", "100", "number")).toBe(false);
  });

  it("treats an absent value as empty for the emptiness operators", () => {
    expect(cmp("", "is_empty")).toBe(true);
    expect(cmp("   ", "is_empty")).toBe(true);
    expect(cmp("x", "is_not_empty")).toBe(true);
  });

  it("matches two absent values as equal", () => {
    expect(cmp("", "equals", "", "number")).toBe(true);
    expect(cmp("", "not_equals", "5", "number")).toBe(true);
  });

  it("keeps contains a string question whatever the declared type", () => {
    // "does 12345 contain 234" is meaningless as arithmetic.
    expect(cmp("12345", "contains", "234", "number")).toBe(true);
    expect(cmp("12345", "not_contains", "999", "number")).toBe(true);
  });

  it("declares which operators ignore the right-hand side", () => {
    for (const op of ["is_empty", "is_not_empty", "is_true", "is_false"]) {
      expect(UNARY_OPERATORS.has(op as never)).toBe(true);
    }
    expect(UNARY_OPERATORS.has("equals")).toBe(false);
  });
});
