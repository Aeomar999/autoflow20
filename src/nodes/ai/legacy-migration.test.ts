import { describe, expect, it } from "vitest";
import {
  isLegacyAiNodeType,
  LEGACY_AI_NODE_TYPES,
  LegacyAiNodeMigrationError,
  migrateLegacyAiNode,
} from "./legacy-migration";
import { configSchema as llmConfigSchema } from "./llm/definition";

describe("isLegacyAiNodeType", () => {
  it("recognises only the three retired tutorial nodes", () => {
    expect(LEGACY_AI_NODE_TYPES).toEqual(["OPENAI", "ANTHROPIC", "GEMINI"]);
    expect(isLegacyAiNodeType("OPENAI")).toBe(true);
    expect(isLegacyAiNodeType("AI_LLM")).toBe(false);
    expect(isLegacyAiNodeType("OPENAI_COMPATIBLE_CHAT")).toBe(false);
  });
});

describe("migrateLegacyAiNode", () => {
  const legacyData = {
    variableName: "reply",
    credentialId: "cm3x9k2p10000abcdefghijkl",
    systemPrompt: "You are terse.",
    userPrompt: "Summarise {{data.body}}",
  };

  it("moves the credential onto the provider's AI_LLM field", () => {
    expect(migrateLegacyAiNode("OPENAI", legacyData).data).toMatchObject({
      model: "openai:gpt-4o",
      openaiCredentialId: "cm3x9k2p10000abcdefghijkl",
    });
    expect(migrateLegacyAiNode("ANTHROPIC", legacyData).data).toMatchObject({
      model: "anthropic:claude-3-5-sonnet",
      anthropicCredentialId: "cm3x9k2p10000abcdefghijkl",
    });
    expect(migrateLegacyAiNode("GEMINI", legacyData).data).toMatchObject({
      model: "google:gemini-1.5-flash",
      geminiCredentialId: "cm3x9k2p10000abcdefghijkl",
    });
  });

  it("keeps the prompts and the variable name intact", () => {
    const { data, type } = migrateLegacyAiNode("OPENAI", legacyData);

    expect(type).toBe("AI_LLM");
    expect(data.variableName).toBe("reply");
    expect(data.systemPrompt).toBe("You are terse.");
    expect(data.userPrompt).toBe("Summarise {{data.body}}");
  });

  it("produces config the AI_LLM schema accepts", () => {
    for (const type of LEGACY_AI_NODE_TYPES) {
      const { data } = migrateLegacyAiNode(type, legacyData);
      expect(llmConfigSchema.safeParse(data).success).toBe(true);
    }
  });

  it("reports the model the node used to run, for the change log", () => {
    expect(migrateLegacyAiNode("OPENAI", legacyData).previousModel).toBe(
      "gpt-4",
    );
    expect(migrateLegacyAiNode("GEMINI", legacyData).previousModel).toBe(
      "gemini-2.0-flash",
    );
  });

  it("preserves engine-level keys but reports undeclared ones", () => {
    const { data, droppedKeys } = migrateLegacyAiNode("OPENAI", {
      ...legacyData,
      _timeoutMs: 30_000,
      _continueOnFail: true,
      legacyKnob: "gone",
      anotherKnob: 1,
    });

    expect(data._timeoutMs).toBe(30_000);
    expect(data._continueOnFail).toBe(true);
    expect(data.legacyKnob).toBeUndefined();
    expect(droppedKeys).toEqual(["anotherKnob", "legacyKnob"]);
  });

  it("migrates a half-configured node without inventing values", () => {
    const { data } = migrateLegacyAiNode("OPENAI", {});

    expect(data.variableName).toBeUndefined();
    expect(data.openaiCredentialId).toBeUndefined();
    expect(data.model).toBe("openai:gpt-4o");
    expect(llmConfigSchema.safeParse(data).success).toBe(true);
  });

  it("tolerates a null or non-object data column", () => {
    expect(() => migrateLegacyAiNode("OPENAI", null)).not.toThrow();
    expect(() => migrateLegacyAiNode("OPENAI", "nonsense")).not.toThrow();
  });

  it("refuses a type it was not written for", () => {
    expect(() => migrateLegacyAiNode("AI_LLM", legacyData)).toThrow(
      LegacyAiNodeMigrationError,
    );
  });
});
