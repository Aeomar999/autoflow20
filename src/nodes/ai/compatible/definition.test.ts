import { describe, expect, it } from "vitest";
import { configSchema, definition } from "./definition";

describe("OPENAI_COMPATIBLE_CHAT definition", () => {
  it("exports a valid NodeDefinition", () => {
    expect(definition).toEqual(
      expect.objectContaining({
        type: "OPENAI_COMPATIBLE_CHAT",
        version: 1,
        category: "AI",
        icon: "Bot",
      }),
    );
  });

  it("accepts an OpenAI-compatible OR an OpenRouter key", () => {
    // AF-M10-23: OpenRouter is OpenAI-compatible, so it runs through this node
    // rather than getting one of its own. Requiring users to re-enter the same
    // key under a second credential type would be paperwork, not a
    // distinction — hence the `a|b` requirement.
    expect(definition.credentials).toEqual([
      {
        key: "credentialId",
        type: "openaiCompatible.apiKey|openrouter.apiKey",
        required: true,
      },
    ]);
  });

  it("accepts a fully-configured chat completion", () => {
    const result = configSchema.safeParse({
      variableName: "chatReply",
      credentialId: "cmtest012345678901234567",
      baseUrl: "https://api.groq.com/openai/{{config.version}}/v1",
      model: "llama-3.3-70b-versatile",
      systemPrompt: "You are a terse assistant.",
      userPrompt: "Summarize: {{json httpResponse.data}}",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a config without the optional fields", () => {
    const result = configSchema.safeParse({
      variableName: "chatReply",
      credentialId: "cmtest012345678901234567",
      baseUrl: "https://api.groq.com/openai/v1",
      model: "llama-3.3-70b-versatile",
      userPrompt: "Hello",
    });
    expect(result.success).toBe(true);
  });

  it("defaults to an empty config for a fresh node", () => {
    const result = configSchema.safeParse(definition.defaults);
    expect(result.success).toBe(true);
  });

  it("rejects a baseUrl exceeding 2048 characters", () => {
    const result = configSchema.safeParse({
      baseUrl: `https://example.com/${"a".repeat(2048)}`,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a model exceeding 256 characters", () => {
    const result = configSchema.safeParse({
      model: "x".repeat(257),
    });
    expect(result.success).toBe(false);
  });
});
