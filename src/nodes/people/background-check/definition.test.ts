import { describe, expect, it } from "vitest";
import { configSchema, definition } from "./definition";

describe("BACKGROUND_CHECK definition", () => {
  it("exports a valid NodeDefinition", () => {
    expect(definition).toEqual(
      expect.objectContaining({
        type: "BACKGROUND_CHECK",
        version: 1,
        category: "ACTION",
      }),
    );
  });

  it("accepts an empty config and defaults the check type to standard", () => {
    const result = configSchema.safeParse({});
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.checkType).toBe("standard");
  });

  it("accepts every check type", () => {
    for (const checkType of ["standard", "enhanced", "reference"] as const) {
      const result = configSchema.safeParse({ checkType });
      expect(result.success).toBe(true);
    }
  });

  it("rejects an unknown check type", () => {
    const result = configSchema.safeParse({ checkType: "security" });
    expect(result.success).toBe(false);
  });

  it("rejects an over-long candidate name", () => {
    const result = configSchema.safeParse({ candidateName: "a".repeat(257) });
    expect(result.success).toBe(false);
  });
});
