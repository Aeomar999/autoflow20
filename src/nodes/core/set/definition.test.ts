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

  it("defaults an absent mapping type to string (AF-M9-08)", () => {
    const result = configSchema.safeParse({
      mappings: [{ key: "name", value: "Ada" }],
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.mappings?.[0].type).toBe("string");
  });

  it("accepts every declared mapping type (AF-M9-08)", () => {
    const result = configSchema.safeParse({
      mappings: [
        { key: "a", value: "1", type: "string" },
        { key: "b", value: "1", type: "number" },
        { key: "c", value: "true", type: "boolean" },
        { key: "d", value: "{}", type: "object" },
        { key: "e", value: "[]", type: "array" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown mapping type (AF-M9-08)", () => {
    const result = configSchema.safeParse({
      mappings: [{ key: "a", value: "1", type: "date" }],
    });
    expect(result.success).toBe(false);
  });
});
