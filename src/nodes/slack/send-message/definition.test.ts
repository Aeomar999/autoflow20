import { describe, expect, it } from "vitest";
import { configSchema, definition } from "./definition";

describe("SLACK definition", () => {
  it("exports a valid NodeDefinition", () => {
    expect(definition).toEqual(
      expect.objectContaining({
        type: "SLACK",
        version: 1,
        category: "ACTION",
      }),
    );
  });

  it("accepts a fully-configured webhook message", () => {
    const result = configSchema.safeParse({
      variableName: "mySlack",
      webhookUrl: "https://hooks.slack.com/{{data.channelId}}",
      content: "Hello {{data.name}}",
    });
    expect(result.success).toBe(true);
  });

  it("defaults to an empty config for a fresh node", () => {
    const result = configSchema.safeParse(definition.defaults);
    expect(result.success).toBe(true);
  });

  it("rejects invalid URL characters", () => {
    const result = configSchema.safeParse({
      webhookUrl: "https://hooks.slack.com/\u0000",
    });
    expect(result.success).toBe(false);
  });

  it("rejects content exceeding 4000 chars", () => {
    const result = configSchema.safeParse({
      content: "x".repeat(4001),
    });
    expect(result.success).toBe(false);
  });

  it("rejects a webhookUrl exceeding 2048 chars", () => {
    const result = configSchema.safeParse({
      webhookUrl: `https://hooks.slack.com/${"a".repeat(2048)}`,
    });
    expect(result.success).toBe(false);
  });
});
