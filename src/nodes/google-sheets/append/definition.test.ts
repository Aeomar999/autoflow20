import { describe, expect, it } from "vitest";
import { configSchema, definition } from "./definition";

describe("GOOGLE_SHEETS_APPEND definition", () => {
  it("exports a valid NodeDefinition", () => {
    expect(definition).toEqual(
      expect.objectContaining({
        type: "GOOGLE_SHEETS_APPEND",
        version: 1,
        category: "ACTION",
        icon: "Table2",
      }),
    );
  });

  it("requires a Google credential, scoped or legacy (AF-M10-03)", () => {
    // The scoped type is what a new binding gets; `google.oauth2` stays
    // accepted so nodes saved before the split keep resolving their existing
    // credential instead of failing at the next run (ADR-0011 / ADR-0023).
    expect(definition.credentials).toEqual([
      {
        key: "credentialId",
        type: "google.sheets|google.oauth2",
        required: true,
      },
    ]);
  });

  it("accepts a fully-configured append", () => {
    const result = configSchema.safeParse({
      variableName: "rows",
      credentialId: "cmtest012345678901234567",
      spreadsheetId: "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms",
      sheetName: "Sheet1",
      values: '[["{{data.email}}", "Jane", 42]]',
    });
    expect(result.success).toBe(true);
  });

  it("accepts a config without values", () => {
    const result = configSchema.safeParse({
      variableName: "rows",
      credentialId: "cmtest012345678901234567",
      spreadsheetId: "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms",
      sheetName: "Sheet1",
    });
    expect(result.success).toBe(true);
  });

  it("defaults to an empty config for a fresh node", () => {
    const result = configSchema.safeParse(definition.defaults);
    expect(result.success).toBe(true);
  });

  it("rejects values exceeding 64KB", () => {
    const result = configSchema.safeParse({
      values: "x".repeat(65_537),
    });
    expect(result.success).toBe(false);
  });
});
