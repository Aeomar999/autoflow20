import { describe, expect, it } from "vitest";
import { configSchema, definition } from "./definition";

describe("POSTGRES_QUERY definition", () => {
  it("exports a valid NodeDefinition", () => {
    expect(definition).toEqual(
      expect.objectContaining({
        type: "POSTGRES_QUERY",
        version: 1,
        category: "ACTION",
        icon: "Database",
      }),
    );
  });

  it("requires the Postgres credential", () => {
    expect(definition.credentials).toEqual([
      { key: "credentialId", type: "postgres", required: true },
    ]);
  });

  it("accepts a fully-configured query", () => {
    const result = configSchema.safeParse({
      variableName: "queryResult",
      credentialId: "cmtest012345678901234567",
      query: "SELECT * FROM users WHERE id = $1 AND active = $2",
      params: '["{{data.userId}}", true]',
    });
    expect(result.success).toBe(true);
  });

  it("defaults to an empty config for a fresh node", () => {
    const result = configSchema.safeParse(definition.defaults);
    expect(result.success).toBe(true);
  });

  it("accepts a config without params", () => {
    const result = configSchema.safeParse({
      variableName: "queryResult",
      credentialId: "cmtest012345678901234567",
      query: "SELECT now()",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a query exceeding 64KB", () => {
    const result = configSchema.safeParse({
      query: "x".repeat(65_537),
    });
    expect(result.success).toBe(false);
  });
});
