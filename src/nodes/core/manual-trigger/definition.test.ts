import { describe, expect, it } from "vitest";
import { configSchema, definition } from "./definition";

describe("MANUAL_TRIGGER definition", () => {
  it("exports a valid NodeDefinition", () => {
    expect(definition).toEqual(
      expect.objectContaining({
        type: "MANUAL_TRIGGER",
        version: 1,
        category: "TRIGGER",
        label: "Manual Trigger",
        icon: "MousePointer",
      }),
    );
  });

  it("has no inputs and one output port", () => {
    expect(definition.inputs).toHaveLength(0);
    expect(definition.outputs).toHaveLength(1);
    expect(definition.outputs[0].id).toBe("main");
  });

  it("accepts empty or absent config", () => {
    expect(configSchema.safeParse({}).success).toBe(true);
    expect(configSchema.safeParse(undefined).success).toBe(true);
  });

  it("rejects non-object configs", () => {
    expect(configSchema.safeParse("invalid").success).toBe(false);
    expect(configSchema.safeParse(123).success).toBe(false);
  });
});
