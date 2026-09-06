import { describe, expect, it } from "vitest";
import { configSchema, definition } from "./definition";

describe("BAMBOOHR_TRIGGER definition", () => {
  it("exports a valid trigger NodeDefinition", () => {
    expect(definition).toEqual(
      expect.objectContaining({
        type: "BAMBOOHR_TRIGGER",
        version: 1,
        category: "TRIGGER",
      }),
    );
    // A trigger takes no input and starts the graph.
    expect(definition.inputs).toEqual([]);
    expect(definition.outputs).toHaveLength(1);
  });

  it("requires the BambooHR credential type", () => {
    expect(definition.credentials).toEqual([
      { key: "credentialId", type: "bamboohr.apiKey", required: true },
    ]);
  });

  it("accepts an empty config", () => {
    expect(configSchema.safeParse({}).success).toBe(true);
  });

  it("accepts a full config", () => {
    const result = configSchema.safeParse({
      credentialId: "clh1234567890abcdefghijk",
      department: "Sales",
      pollIntervalSeconds: 900,
    });
    expect(result.success).toBe(true);
  });

  it("refuses a poll interval faster than the sweep can run", () => {
    expect(configSchema.safeParse({ pollIntervalSeconds: 30 }).success).toBe(
      false,
    );
  });

  it("refuses a poll interval beyond a day", () => {
    expect(
      configSchema.safeParse({ pollIntervalSeconds: 86_401 }).success,
    ).toBe(false);
  });

  it("rejects an over-long department filter", () => {
    expect(
      configSchema.safeParse({ department: "a".repeat(201) }).success,
    ).toBe(false);
  });
});
