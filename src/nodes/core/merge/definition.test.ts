import { describe, expect, it } from "vitest";
import { definition, configSchema } from "./definition";

describe("MERGE definition", () => {
  it("exports a valid NodeDefinition", () => {
    expect(definition).toEqual(
      expect.objectContaining({
        type: "MERGE",
        version: 1,
        category: "LOGIC",
      }),
    );
  });

  it("accepts a valid append config", () => {
    const result = configSchema.safeParse({ mode: "append" });
    expect(result.success).toBe(true);
  });

  it("accepts a valid combine config", () => {
    const result = configSchema.safeParse({ mode: "combine", combineKey: "myData" });
    expect(result.success).toBe(true);
  });

  it("accepts empty config (defaults apply)", () => {
    const result = configSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("rejects unknown mode", () => {
    const result = configSchema.safeParse({ mode: "zip" });
    expect(result.success).toBe(false);
  });
});
