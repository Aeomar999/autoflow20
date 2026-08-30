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

  it("accepts valid payload string", () => {
    const result = configSchema.safeParse({
      payload: '{"key": "value"}',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.payload).toBe('{"key": "value"}');
    }
  });

  it("rejects non-string payload", () => {
    expect(configSchema.safeParse({ payload: 12345 }).success).toBe(false);
  });
});
