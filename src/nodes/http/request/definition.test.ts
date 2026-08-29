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

  it("rejects timeoutMs out of range [250, 60000]", () => {
    expect(configSchema.safeParse({ timeoutMs: 100 }).success).toBe(false);
    expect(configSchema.safeParse({ timeoutMs: 100_000 }).success).toBe(false);
  });
});
