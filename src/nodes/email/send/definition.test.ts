import { describe, expect, it } from "vitest";
import { configSchema, definition } from "./definition";

describe("EMAIL_SEND definition", () => {
  it("exports a valid NodeDefinition", () => {
    expect(definition).toEqual(
      expect.objectContaining({
        type: "EMAIL_SEND",
        version: 1,
        category: "ACTION",
      }),
    );
  });

  it("requires the SMTP credential", () => {
    expect(definition.credentials).toEqual([
      { key: "credentialId", type: "smtp", required: true },
    ]);
  });

  it("accepts a fully-configured email", () => {
    const result = configSchema.safeParse({
      variableName: "sentEmail",
      credentialId: "cmtest012345678901234567",
      from: "no-reply@example.com",
      fromName: "Acme",
      to: "team@example.com",
      cc: "lead@example.com",
      bcc: "audit@example.com",
      subject: "Hello {{data.userId}}",
      body: "Welcome!",
    });
    expect(result.success).toBe(true);
  });

  it("defaults to an empty config for a fresh node", () => {
    const result = configSchema.safeParse(definition.defaults);
    expect(result.success).toBe(true);
  });

  it("rejects an invalid from address", () => {
    const result = configSchema.safeParse({ from: "not-an-email" });
    expect(result.success).toBe(false);
  });

  it("rejects a body exceeding 100KB", () => {
    const result = configSchema.safeParse({
      body: "x".repeat(100_001),
    });
    expect(result.success).toBe(false);
  });
});
