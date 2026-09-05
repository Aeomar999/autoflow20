import { describe, expect, it } from "vitest";
import { configSchema, definition } from "./definition";

describe("ONBOARDING_CHECKLIST definition", () => {
  it("exports a valid NodeDefinition", () => {
    expect(definition).toEqual(
      expect.objectContaining({
        type: "ONBOARDING_CHECKLIST",
        version: 1,
        category: "TRANSFORM",
      }),
    );
  });

  it("accepts an empty config", () => {
    const result = configSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts a valid item list", () => {
    const result = configSchema.safeParse({
      roleTitle: "Staff Engineer",
      items: [
        { key: "laptop", label: "Provision laptop", dueOffsetDays: 0 },
        { key: "badge", label: "Order access badge", owner: "SecOps" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty item list", () => {
    const result = configSchema.safeParse({ items: [] });
    expect(result.success).toBe(false);
  });

  it("rejects an item with a blank label", () => {
    const result = configSchema.safeParse({
      items: [{ key: "laptop", label: "" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an item with a negative due offset", () => {
    const result = configSchema.safeParse({
      items: [{ key: "laptop", label: "Provision laptop", dueOffsetDays: -1 }],
    });
    expect(result.success).toBe(false);
  });
});
