import { describe, expect, it } from "vitest";
import { configSchema, definition } from "./definition";

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

  it("accepts valid cron and timezone", () => {
    const result = configSchema.safeParse({
      cron: "0 0 * * *",
      timezone: "America/New_York",
    });
    expect(result.success).toBe(true);
  });

  it("accepts empty config with defaults", () => {
    const result = configSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cron).toBe("0 * * * *");
      expect(result.data.timezone).toBe("UTC");
    }
  });

  it("rejects non-string cron", () => {
    const result = configSchema.safeParse({ cron: 12345 });
    expect(result.success).toBe(false);
  });
});
