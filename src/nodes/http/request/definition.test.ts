import { describe, expect, it } from "vitest";
import { configSchema, definition } from "./definition";

describe("HTTP_REQUEST definition", () => {
  it("exports a valid NodeDefinition", () => {
    expect(definition).toEqual(
      expect.objectContaining({
        type: "HTTP_REQUEST",
        version: 1,
        category: "ACTION",
        label: "HTTP Request",
        icon: "Globe",
      }),
    );
  });

  it("has one input and one output port", () => {
    expect(definition.inputs).toHaveLength(1);
    expect(definition.inputs[0].id).toBe("main");
    expect(definition.outputs).toHaveLength(1);
    expect(definition.outputs[0].id).toBe("main");
  });

  it("accepts a valid HTTP request config", () => {
    const result = configSchema.safeParse({
      variableName: "myApi",
      endpoint: "https://api.example.com/v1/users",
      method: "POST",
      body: JSON.stringify({ name: "Alice" }),
      headers: { Authorization: "Bearer test" },
      queryParams: { page: "1" },
      timeoutMs: 5000,
      failOnNon2xx: true,
    });
    expect(result.success).toBe(true);
  });

  it("accepts empty config", () => {
    expect(configSchema.safeParse({}).success).toBe(true);
  });

  it("rejects invalid HTTP method", () => {
    const result = configSchema.safeParse({
      method: "INVALID_METHOD",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid variableName starting with number", () => {
    const result = configSchema.safeParse({
      variableName: "123invalid",
    });
    expect(result.success).toBe(false);
  });

  it("rejects endpoint containing control characters", () => {
    const result = configSchema.safeParse({
      endpoint: "https://example.com/\x00bad",
    });
    expect(result.success).toBe(false);
  });

  it("declares a wildcard, optional credential requirement (AF-M10-01)", () => {
    expect(definition.credentials).toEqual([
      { key: "credentialId", type: "*", required: false },
    ]);
  });

  it("accepts an authenticated config", () => {
    expect(
      configSchema.safeParse({
        variableName: "myApi",
        endpoint: "https://api.example.com/v1/users",
        method: "GET",
        credentialId: "cm7xk2p9q0000abcdefghijkl",
        authMode: "bearer",
      }).success,
    ).toBe(true);
  });

  it("still validates a node saved before auth existed — no migration", () => {
    // Every HTTP_REQUEST persisted before AF-M10-01 has neither credentialId
    // nor authMode. If this stopped parsing, saved workflows would fail to
    // load, which is the one outcome the task forbids.
    expect(
      configSchema.safeParse({
        variableName: "legacy",
        endpoint: "https://api.example.com/v1/users",
        method: "GET",
        headers: { "X-Thing": "1" },
      }).success,
    ).toBe(true);
  });

  it("rejects an unknown auth mode", () => {
    expect(configSchema.safeParse({ authMode: "hmac" }).success).toBe(false);
  });

  it("rejects timeoutMs out of range [250, 60000]", () => {
    expect(configSchema.safeParse({ timeoutMs: 100 }).success).toBe(false);
    expect(configSchema.safeParse({ timeoutMs: 100_000 }).success).toBe(false);
  });
});
