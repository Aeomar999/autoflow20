import { describe, expect, it } from "vitest";
import { configSchema, definition } from "./definition";

describe("ILLNESS_SUMMARY definition", () => {
  it("exports a valid NodeDefinition", () => {
    expect(definition).toEqual(
      expect.objectContaining({
        type: "ILLNESS_SUMMARY",
        version: 1,
        category: "AI",
        supportsResponseCache: true,
      }),
    );
  });

  it("declares LLM credentials bound to config credential fields", () => {
    expect(definition.credentials).toHaveLength(3);
    expect(definition.credentials?.map((c) => c.key)).toEqual([
      "openaiCredentialId",
      "anthropicCredentialId",
      "geminiCredentialId",
    ]);
    expect(definition.credentials?.map((c) => c.type)).toEqual([
      "openai.apiKey",
      "anthropic.apiKey",
      "gemini.apiKey",
    ]);
    for (const credential of definition.credentials ?? []) {
      expect(credential.required).toBe(false);
    }
  });

  it("accepts an empty config and defaults temperature to 0.7", () => {
    const result = configSchema.safeParse({});
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.temperature).toBe(0.7);
  });

  it("accepts a valid model id", () => {
    const result = configSchema.safeParse({ model: "gpt-4o" });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid model id", () => {
    const result = configSchema.safeParse({ model: "gpt 4o!" });
    expect(result.success).toBe(false);
  });

  it("rejects an overlong prompt", () => {
    const result = configSchema.safeParse({
      userPrompt: "x".repeat(100_001),
    });
    expect(result.success).toBe(false);
  });
});
