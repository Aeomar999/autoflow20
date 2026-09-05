import { describe, expect, it } from "vitest";
import { formatLastSaved } from "./format-last-saved";

/**
 * AF-UX-03 — the "Last saved:" relative-time formatter.
 *
 * The interesting behaviour is the bound handling: no save yet renders nothing,
 * a clock running ahead of the save clamps to "just now", singular/plural
 * minute text, and crossing the hour switches to a wall-clock time.
 */
describe("formatLastSaved (AF-UX-03)", () => {
  const NOW = 1_800_000_000_000;

  it("renders an empty string before the first save", () => {
    expect(formatLastSaved(null, NOW)).toBe("");
  });

  it("says just now for sub-2s freshness, including a future clock", () => {
    expect(formatLastSaved(NOW, NOW)).toBe("just now");
    expect(formatLastSaved(NOW, NOW + 999)).toBe("just now");
    expect(formatLastSaved(NOW + 5000, NOW)).toBe("just now");
  });

  it("renders seconds for everything under a minute", () => {
    expect(formatLastSaved(NOW - 2000, NOW)).toBe("2 seconds ago");
    expect(formatLastSaved(NOW - 59_000, NOW)).toBe("59 seconds ago");
  });

  it("renders singular and plural minutes under an hour", () => {
    expect(formatLastSaved(NOW - 60_000, NOW)).toBe("1 minute ago");
    expect(formatLastSaved(NOW - 120_000, NOW)).toBe("2 minutes ago");
    expect(formatLastSaved(NOW - 3_599_000, NOW)).toBe("59 minutes ago");
  });

  it("switches to a wall-clock time past the hour", () => {
    const savedAt = new Date(2026, 8, 5, 14, 30, 0).getTime();
    const expected = `at ${new Date(savedAt).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    })}`;
    expect(formatLastSaved(savedAt, savedAt + 3_600_000)).toBe(expected);
  });
});
