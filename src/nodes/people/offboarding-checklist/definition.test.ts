import { describe, expect, it } from "vitest";
import { configSchema, definition } from "./definition";

describe("OFFBOARDING_CHECKLIST definition", () => {
  it("exports a valid NodeDefinition", () => {
    expect(definition).toEqual(
      expect.objectContaining({
        type: "OFFBOARDING_CHECKLIST",
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
        { key: "access", label: "Revoke system access", dueOffsetDays: 0 },
        { key: "hardware", label: "Arrange hardware return", owner: "IT" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty item list", () => {
    const result = configSchema.safeParse({ items: [] });
    expect(result.success).toBe(false);
  });

  it("rejects an item with an invalid key", () => {
    const result = configSchema.safeParse({
      items: [{ key: "bad key!", label: "Revoke system access" }],
    });
    expect(result.success).toBe(false);
  });
});
