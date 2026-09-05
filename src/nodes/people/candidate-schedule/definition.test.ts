import { describe, expect, it } from "vitest";
import { configSchema, definition } from "./definition";

describe("CANDIDATE_SCHEDULE definition", () => {
  it("exports a valid NodeDefinition", () => {
    expect(definition).toEqual(
      expect.objectContaining({
        type: "CANDIDATE_SCHEDULE",
        version: 1,
        category: "ACTION",
      }),
    );
  });

  it("accepts an empty config and defaults the interview type to recruiter", () => {
    const result = configSchema.safeParse({});
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.interviewType).toBe("recruiter");
  });

  it("accepts every interview type", () => {
    for (const interviewType of [
      "recruiter",
      "technical",
      "panel",
      "final",
    ] as const) {
      const result = configSchema.safeParse({ interviewType });
      expect(result.success).toBe(true);
    }
  });

  it("rejects an unknown interview type", () => {
    const result = configSchema.safeParse({ interviewType: "onsite" });
    expect(result.success).toBe(false);
  });

  it("rejects an over-long candidate email", () => {
    const result = configSchema.safeParse({
      candidateEmail: "a".repeat(513),
    });
    expect(result.success).toBe(false);
  });
});
