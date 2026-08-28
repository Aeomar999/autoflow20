import { describe, expect, it } from "vitest";
import { configSchema, definition } from "./definition";

describe("AIRTABLE_CREATE_RECORD definition", () => {
  it("exports a valid NodeDefinition", () => {
    expect(definition).toEqual(
      expect.objectContaining({
        type: "AIRTABLE_CREATE_RECORD",
        version: 1,
        category: "ACTION",
        icon: "Table",
      }),
    );
  });

  it("requires the Airtable API-key credential", () => {
    expect(definition.credentials).toEqual([
      { key: "credentialId", type: "airtable.apiKey", required: true },
    ]);
  });

  it("accepts a fully-configured create-record", () => {
    const result = configSchema.safeParse({
      variableName: "airtableResult",
      credentialId: "cmtest012345678901234567",
      baseId: "appTESTBASE",
      tableId: "tblLeads",
      fields: '{"Name": "{{data.name}}", "Score": 42}',
    });
    expect(result.success).toBe(true);
  });

  it("accepts a config without fields", () => {
    const result = configSchema.safeParse({
      variableName: "airtableResult",
      credentialId: "cmtest012345678901234567",
      baseId: "appTESTBASE",
      tableId: "tblLeads",
    });
    expect(result.success).toBe(true);
  });

  it("defaults to an empty config for a fresh node", () => {
    const result = configSchema.safeParse(definition.defaults);
    expect(result.success).toBe(true);
  });

  it("rejects fields exceeding 64KB", () => {
    const result = configSchema.safeParse({
      fields: "x".repeat(65_537),
    });
    expect(result.success).toBe(false);
  });
});
