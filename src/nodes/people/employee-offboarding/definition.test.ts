import { describe, expect, it } from "vitest";
import { configSchema, definition } from "./definition";

describe("EMPLOYEE_OFFBOARDING definition", () => {
  it("exports a valid NodeDefinition", () => {
    expect(definition).toEqual(
      expect.objectContaining({
        type: "EMPLOYEE_OFFBOARDING",
        version: 1,
        category: "ACTION",
      }),
    );
  });

  it("accepts an empty config", () => {
    const result = configSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts a full config", () => {
    const result = configSchema.safeParse({
      variableName: "offboarding",
      employeeRef: "EMP-ADA-009",
      exitDate: "2026-12-31",
      exitReason: "Resigned to relocate",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an over-long employee reference", () => {
    const result = configSchema.safeParse({ employeeRef: "a".repeat(201) });
    expect(result.success).toBe(false);
  });

  it("rejects an over-long exit date", () => {
    const result = configSchema.safeParse({ exitDate: "a".repeat(129) });
    expect(result.success).toBe(false);
  });

  it("rejects an over-long exit reason", () => {
    const result = configSchema.safeParse({ exitReason: "a".repeat(501) });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid variable name", () => {
    const result = configSchema.safeParse({ variableName: "9bad" });
    expect(result.success).toBe(false);
  });
});
