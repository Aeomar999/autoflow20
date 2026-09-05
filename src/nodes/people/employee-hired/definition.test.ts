import { describe, expect, it } from "vitest";
import { configSchema, definition } from "./definition";

describe("EMPLOYEE_HIRED definition", () => {
  it("exports a valid NodeDefinition", () => {
    expect(definition).toEqual(
      expect.objectContaining({
        type: "EMPLOYEE_HIRED",
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
      variableName: "hire",
      employeeRef: "EMP-ADA-009",
      email: "ada@example.com",
      fullName: "Ada Boateng",
      role: "Account Executive",
      department: "Sales",
      managerEmail: "boss@example.com",
      personalEmail: "ada.personal@example.com",
      startDate: "2026-11-01",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an over-long employee reference", () => {
    const result = configSchema.safeParse({ employeeRef: "a".repeat(201) });
    expect(result.success).toBe(false);
  });

  it("rejects an over-long full name", () => {
    const result = configSchema.safeParse({ fullName: "a".repeat(301) });
    expect(result.success).toBe(false);
  });

  it("rejects an over-long email", () => {
    const result = configSchema.safeParse({ email: "a".repeat(513) });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid variable name", () => {
    const result = configSchema.safeParse({ variableName: "9bad" });
    expect(result.success).toBe(false);
  });
});
