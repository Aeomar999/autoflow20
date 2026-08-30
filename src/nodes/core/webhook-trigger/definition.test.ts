import { describe, expect, it } from "vitest";
import { configSchema, definition } from "./definition";

describe("WEBHOOK_TRIGGER definition", () => {
  it("exports a valid NodeDefinition", () => {
    expect(definition).toEqual(
      expect.objectContaining({
        type: "WEBHOOK_TRIGGER",
        version: 1,
        category: "TRIGGER",
      }),
    );
  });

  it("has no inputs", () => {
    expect(definition.inputs).toHaveLength(0);
  });

  it("has one output", () => {
    expect(definition.outputs).toHaveLength(1);
  });

  it("accepts empty or absent config", () => {
    expect(configSchema.safeParse({}).success).toBe(true);
    expect(configSchema.safeParse(undefined).success).toBe(true);
  });

  it("rejects non-object config", () => {
    expect(configSchema.safeParse(12345).success).toBe(false);
  });
});
