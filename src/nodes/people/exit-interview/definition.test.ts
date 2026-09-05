import { describe, expect, it } from "vitest";
import { configSchema, definition } from "./definition";

describe("EXIT_INTERVIEW definition", () => {
  it("exports a valid NodeDefinition", () => {
    expect(definition).toEqual(
      expect.objectContaining({
        type: "EXIT_INTERVIEW",
        version: 1,
        category: "ACTION",
      }),
    );
  });

  it("accepts an empty config and defaults the format to video", () => {
    const result = configSchema.safeParse({});
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.format).toBe("video");
  });

  it("accepts every format", () => {
    for (const format of ["video", "in_person", "written"] as const) {
      const result = configSchema.safeParse({ format });
      expect(result.success).toBe(true);
    }
  });

  it("rejects an unknown format", () => {
    const result = configSchema.safeParse({ format: "phone" });
    expect(result.success).toBe(false);
  });

  it("accepts focus areas as a field list", () => {
    const result = configSchema.safeParse({
      focusAreas: [{ area: "Why leaving" }, { area: "Compensation" }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects more than 10 focus areas", () => {
    const result = configSchema.safeParse({
      focusAreas: Array.from({ length: 11 }, (_, i) => ({ area: `area-${i}` })),
    });
    expect(result.success).toBe(false);
  });

  it("rejects a focus area without a label", () => {
    const result = configSchema.safeParse({ focusAreas: [{ area: "" }] });
    expect(result.success).toBe(false);
  });
});
