import { describe, expect, it } from "vitest";
import { PLAN_RETENTION } from "@/lib/retention";
import { retentionNotice } from "./retention-notice";

/**
 * AF-M8-20. The notice exists so a reader does not mistake a retention
 * boundary for a quiet month, so the tests are about when it appears and when
 * it stays out of the way - a banner on every page would be noise, and noise
 * is why people stop reading banners.
 */

describe("retentionNotice", () => {
  it("says nothing when the range fits inside what the plan keeps", () => {
    // PRO keeps payloads 90 days and runs 365, so a 30-day view is complete.
    expect(retentionNotice(30, "PRO")).toBeNull();
  });

  it("says nothing at the exact boundary", () => {
    // Equal is fine: 7 days of history covers a 7-day range.
    expect(
      retentionNotice(PLAN_RETENTION.FREE.ioRetentionDays, "FREE"),
    ).toBeNull();
  });

  it("warns when the range is wider than the history the plan keeps", () => {
    const notice = retentionNotice(90, "FREE");

    expect(notice?.message).toContain("35 days");
    expect(notice?.message).toContain("90 days");
    expect(notice?.affectsPayloads).toBe(true);
  });

  it("mentions payload erasure when only the payloads have aged out", () => {
    // FREE erases inputs/outputs at 7 days but keeps the runs to 35, so a
    // 30-day range has complete history and incomplete detail.
    const notice = retentionNotice(30, "FREE");

    expect(notice).not.toBeNull();
    expect(notice?.message).toContain("7 days");
    expect(notice?.message).toMatch(/inputs and outputs/);
    expect(notice?.affectsPayloads).toBe(true);
    // It must NOT claim runs are missing - they are not.
    expect(notice?.message).not.toMatch(/at most/);
  });

  it("prefers the history warning when both are true", () => {
    const notice = retentionNotice(90, "FREE");
    expect(notice?.message).toContain("at most");
  });

  it("never warns for a plan that keeps history forever", () => {
    // ENTERPRISE deletes nothing, so no range can exceed its history. The
    // 90-day cap on the picker is well inside its 365-day payload window too.
    expect(retentionNotice(90, "ENTERPRISE")).toBeNull();
  });

  it("treats an unknown or missing plan as FREE rather than unlimited", () => {
    // Same ADR-0010 collapse the pruner uses: an unrecognised plan must not be
    // told its history goes back further than it does.
    for (const plan of [null, undefined, "LEGACY", ""]) {
      expect(retentionNotice(90, plan)?.message).toContain("35 days");
    }
  });

  it("uses a singular day where that reads correctly", () => {
    expect(retentionNotice(2, "FREE")).toBeNull();
    const notice = retentionNotice(8, "FREE");
    expect(notice?.message).toContain("7 days");
  });

  it("produces a message that stands on its own", () => {
    const notice = retentionNotice(90, "STARTER");
    expect(notice?.message.endsWith(".")).toBe(true);
    expect(notice?.message.length).toBeGreaterThan(30);
  });
});
