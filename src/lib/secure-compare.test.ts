import { describe, expect, it } from "vitest";
import { secureCompare } from "./secure-compare";

describe("secureCompare", () => {
  it("returns true for equal strings", () => {
    expect(secureCompare("abc", "abc")).toBe(true);
    expect(secureCompare("", "")).toBe(true);
  });

  it("returns false for different strings of any length", () => {
    expect(secureCompare("abc", "abd")).toBe(false);
    expect(secureCompare("abc", "abcd")).toBe(false);
    expect(secureCompare("a", "")).toBe(false);
  });
});
