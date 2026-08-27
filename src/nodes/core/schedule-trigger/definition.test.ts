import { describe, expect, it } from "vitest";
import { definition } from "./definition";

describe("SCHEDULE_TRIGGER definition", () => {
  it("exports a valid NodeDefinition", () => {
    expect(definition).toEqual(
      expect.objectContaining({
        type: "SCHEDULE_TRIGGER",
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
});
