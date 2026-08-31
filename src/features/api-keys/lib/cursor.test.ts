import { describe, expect, it } from "vitest";
import {
  CURSOR_PAGE_DEFAULTS,
  decodeCursor,
  encodeCursor,
  parseLimit,
} from "./cursor";

describe("encodeCursor / decodeCursor", () => {
  it("round-trips a cursor", () => {
    const raw = encodeCursor("2026-08-31T10:00:00.000Z", "wf_abc");
    expect(decodeCursor(raw)).toEqual({
      sortValue: "2026-08-31T10:00:00.000Z",
      id: "wf_abc",
    });
  });

  it("returns null for absent, empty, or malformed input", () => {
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor("")).toBeNull();
    expect(decodeCursor("not-base64")).toBeNull();
    expect(decodeCursor(Buffer.from("{}").toString("base64url"))).toBeNull();
    expect(
      decodeCursor(Buffer.from('["only-one"]').toString("base64url")),
    ).toBeNull();
  });

  it("produces URL-safe output with no padding", () => {
    const raw = encodeCursor("a", "b");
    expect(raw).not.toMatch(/[+/=]/);
  });
});

describe("parseLimit", () => {
  it("defaults when absent, empty, or non-numeric", () => {
    expect(parseLimit(null)).toBe(CURSOR_PAGE_DEFAULTS.DEFAULT_LIMIT);
    expect(parseLimit(undefined)).toBe(CURSOR_PAGE_DEFAULTS.DEFAULT_LIMIT);
    expect(parseLimit("")).toBe(CURSOR_PAGE_DEFAULTS.DEFAULT_LIMIT);
    expect(parseLimit("banana")).toBe(CURSOR_PAGE_DEFAULTS.DEFAULT_LIMIT);
  });

  it("clamps below 1 to the default and above MAX_LIMIT to the cap", () => {
    expect(parseLimit("0")).toBe(CURSOR_PAGE_DEFAULTS.DEFAULT_LIMIT);
    expect(parseLimit("-5")).toBe(CURSOR_PAGE_DEFAULTS.DEFAULT_LIMIT);
    expect(parseLimit("1000")).toBe(CURSOR_PAGE_DEFAULTS.MAX_LIMIT);
  });

  it("floors fractional values", () => {
    expect(parseLimit("7.9")).toBe(7);
  });
});
