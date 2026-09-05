import { describe, expect, it } from "vitest";
import { configSchema, definition } from "./definition";

describe("OFFER_LETTER definition", () => {
  it("exports a valid NodeDefinition", () => {
    expect(definition).toEqual(
      expect.objectContaining({
        type: "OFFER_LETTER",
        version: 1,
        category: "ACTION",
      }),
    );
  });

  it("accepts an empty config and defaults employment type to full_time", () => {
    const result = configSchema.safeParse({});
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.employmentType).toBe("full_time");
  });

  it("accepts every employment type", () => {
    for (const employmentType of [
      "full_time",
      "part_time",
      "contract",
    ] as const) {
      const result = configSchema.safeParse({ employmentType });
      expect(result.success).toBe(true);
    }
  });

  it("rejects an unknown employment type", () => {
    const result = configSchema.safeParse({ employmentType: "intern" });
    expect(result.success).toBe(false);
  });

  it("rejects an over-long compensation text", () => {
    const result = configSchema.safeParse({
      compensationText: "a".repeat(1025),
    });
    expect(result.success).toBe(false);
  });
});
