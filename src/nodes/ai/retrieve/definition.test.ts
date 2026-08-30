import { describe, expect, it } from "vitest";
import { configSchema, definition } from "./definition";

describe("AI_RETRIEVE definition", () => {
  it("validates a valid configuration", () => {
    const validConfig = {
      variableName: "retrievedDocs",
      query: "{{$json.userQuery}}",
      sourceIds: "source_123, source_456",
      topK: 5,
      minSimilarity: 0.7,
      credentialId: "cuid1234567890123456789012",
    };

    const parsed = configSchema.parse(validConfig);
    expect(parsed.variableName).toBe("retrievedDocs");
    expect(parsed.topK).toBe(5);
    expect(parsed.minSimilarity).toBe(0.7);
  });

  it("applies defaults without error", () => {
    const parsed = configSchema.parse(definition.defaults);
    expect(parsed.topK).toBe(4);
    expect(parsed.minSimilarity).toBe(0.5);
  });

  it("rejects invalid variable names", () => {
    expect(() =>
      configSchema.parse({
        variableName: "123-invalid",
        query: "test",
      }),
    ).toThrow();
  });

  it("has complete node metadata", () => {
    expect(definition.type).toBe("AI_RETRIEVE");
    expect(definition.category).toBe("AI");
    expect(definition.inputs).toHaveLength(1);
    expect(definition.outputs).toHaveLength(1);
  });
});
