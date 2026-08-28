import { describe, expect, it } from "vitest";
import { configSchema, definition } from "./definition";

describe("CONDITION definition", () => {
  it("exports a valid NodeDefinition", () => {
    expect(definition).toEqual(
      expect.objectContaining({
        type: "CONDITION",
        version: 1,
        category: "LOGIC",
      }),
    );
  });

  it("has true and false output ports", () => {
    expect(definition.outputs.map((o) => o.id)).toEqual(["true", "false"]);
  });

  it("accepts a valid config", () => {
    const result = configSchema.safeParse({
      left: "{{count}}",
      operator: "gt",
      right: "5",
    });
    expect(result.success).toBe(true);
  });

  it("accepts empty config (all fields optional)", () => {
    const result = configSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("rejects unknown operator", () => {
    const result = configSchema.safeParse({
      left: "x",
      operator: "xor",
      right: "y",
    });
    expect(result.success).toBe(false);
  });
});
