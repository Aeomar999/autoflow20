import { describe, expect, it } from "vitest";
import { configSchema, definition } from "./definition";

describe("BENEFITS_ENROLLMENT definition", () => {
  it("exports a valid NodeDefinition", () => {
    expect(definition).toEqual(
      expect.objectContaining({
        type: "BENEFITS_ENROLLMENT",
        version: 1,
        category: "ACTION",
      }),
    );
  });

  it("accepts an empty config and defaults the plan to medical", () => {
    const result = configSchema.safeParse({});
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.plan).toBe("medical");
  });

  it("accepts every plan", () => {
    for (const plan of [
      "medical",
      "dental",
      "vision",
      "life",
      "401k",
    ] as const) {
      const result = configSchema.safeParse({ plan });
      expect(result.success).toBe(true);
    }
  });

  it("rejects an unknown plan", () => {
    const result = configSchema.safeParse({ plan: "pension" });
    expect(result.success).toBe(false);
  });

  it("rejects a negative dependents count", () => {
    const result = configSchema.safeParse({ dependentsCount: -1 });
    expect(result.success).toBe(false);
  });
});
