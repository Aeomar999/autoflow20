import { describe, expect, it } from "vitest";
import { configSchema, definition } from "./definition";

describe("SET definition", () => {
  it("exports a valid NodeDefinition", () => {
    expect(definition).toEqual(
      expect.objectContaining({
        type: "SET",
        version: 1,
        category: "TRANSFORM",
      }),
    );
  });

  it("accepts an empty mappings array", () => {
    const result = configSchema.safeParse({ mappings: [] });
    expect(result.success).toBe(true);
  });

  it("rejects mappings exceeding max 50", () => {
    const result = configSchema.safeParse({
      mappings: Array.from({ length: 51 }, (_, i) => ({
        key: `k${i}`,
        value: `v${i}`,
      })),
    });
    expect(result.success).toBe(false);
  });
});
