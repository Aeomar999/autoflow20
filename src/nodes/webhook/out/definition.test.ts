import { describe, expect, it } from "vitest";
import { configSchema, definition } from "./definition";

describe("WEBHOOK_OUT definition", () => {
  it("exports a valid NodeDefinition", () => {
    expect(definition).toEqual(
      expect.objectContaining({
        type: "WEBHOOK_OUT",
        version: 1,
        category: "ACTION",
      }),
    );
  });

  it("accepts a fully-configured webhook", () => {
    const result = configSchema.safeParse({
      variableName: "myWebhook",
      url: "https://hooks.example.com/{{data.userId}}",
      headers: { "Content-Type": "application/json" },
      body: '{"event": "created"}',
      timeoutMs: 5000,
      failOnNon2xx: true,
    });
    expect(result.success).toBe(true);
  });

  it("defaults to an empty config for a fresh node", () => {
    const result = configSchema.safeParse(definition.defaults);
    expect(result.success).toBe(true);
  });

  it("rejects invalid URL characters", () => {
    const result = configSchema.safeParse({
      url: "https://example.com/\u0000",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a body exceeding 65KB", () => {
    const result = configSchema.safeParse({
      body: "x".repeat(65_537),
    });
    expect(result.success).toBe(false);
  });
});
