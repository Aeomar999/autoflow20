import { describe, expect, it } from "vitest";
import { configSchema, definition } from "./definition";

describe("CANDIDATE_SCORE_RANK definition", () => {
  it("exports a valid NodeDefinition", () => {
    expect(definition).toEqual(
      expect.objectContaining({
        type: "CANDIDATE_SCORE_RANK",
        version: 1,
        category: "TRANSFORM",
      }),
    );
  });

  it("accepts an empty config", () => {
    const result = configSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts a valid rubric", () => {
    const result = configSchema.safeParse({
      rubric: [
        { key: "skills", label: "Skills fit", weight: 0.6 },
        { key: "culture", label: "Culture fit", weight: 0.4 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty rubric", () => {
    const result = configSchema.safeParse({ rubric: [] });
    expect(result.success).toBe(false);
  });

  it("rejects a rubric with more than 20 criteria", () => {
    const result = configSchema.safeParse({
      rubric: Array.from({ length: 21 }, (_, i) => ({
        key: `key${i}`,
        label: `Criterion ${i}`,
        weight: 0.05,
      })),
    });
    expect(result.success).toBe(false);
  });

  it("rejects a blank criterion key", () => {
    const result = configSchema.safeParse({
      rubric: [{ key: "", label: "Skills fit", weight: 0.6 }],
    });
    expect(result.success).toBe(false);
  });
});
