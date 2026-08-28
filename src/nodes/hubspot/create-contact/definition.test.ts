import { describe, expect, it } from "vitest";
import { configSchema, definition } from "./definition";

describe("HUBSPOT_CREATE_CONTACT definition", () => {
  it("exports a valid NodeDefinition", () => {
    expect(definition).toEqual(
      expect.objectContaining({
        type: "HUBSPOT_CREATE_CONTACT",
        version: 1,
        category: "ACTION",
        icon: "Contact",
      }),
    );
  });

  it("requires the HubSpot API-key credential", () => {
    expect(definition.credentials).toEqual([
      { key: "credentialId", type: "hubspot.apiKey", required: true },
    ]);
  });

  it("accepts a fully-configured create-contact", () => {
    const result = configSchema.safeParse({
      variableName: "hubspotResult",
      credentialId: "cmtest012345678901234567",
      properties: '{"email": "{{data.email}}", "firstname": "Ada"}',
    });
    expect(result.success).toBe(true);
  });

  it("accepts a config without properties", () => {
    const result = configSchema.safeParse({
      variableName: "hubspotResult",
      credentialId: "cmtest012345678901234567",
    });
    expect(result.success).toBe(true);
  });

  it("defaults to an empty config for a fresh node", () => {
    const result = configSchema.safeParse(definition.defaults);
    expect(result.success).toBe(true);
  });

  it("rejects properties exceeding 64KB", () => {
    const result = configSchema.safeParse({
      properties: "x".repeat(65_537),
    });
    expect(result.success).toBe(false);
  });
});
