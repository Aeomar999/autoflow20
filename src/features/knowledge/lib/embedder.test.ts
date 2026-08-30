import { describe, expect, it, vi } from "vitest";
import { embedQuery, embedTexts, resolveOpenAiKey } from "./embedder";

vi.mock("ai", () => ({
  embed: vi.fn().mockResolvedValue({
    embedding: Array.from({ length: 1536 }, () => 0.05),
  }),
  embedMany: vi.fn().mockResolvedValue({
    embeddings: [
      Array.from({ length: 1536 }, () => 0.05),
      Array.from({ length: 1536 }, () => 0.08),
    ],
  }),
}));

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn().mockReturnValue({
    embedding: vi.fn(),
  }),
}));

describe("resolveOpenAiKey", () => {
  it("uses provided apiKey option directly", async () => {
    const key = await resolveOpenAiKey({ apiKey: "sk-test-direct-key" });
    expect(key).toBe("sk-test-direct-key");
  });

  it("throws descriptive error when no key or credential is found", async () => {
    const oldEnv = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    await expect(resolveOpenAiKey({})).rejects.toThrow(
      /No OpenAI API key found for knowledge base embeddings/,
    );

    if (oldEnv) process.env.OPENAI_API_KEY = oldEnv;
  });
});

describe("embedQuery and embedTexts", () => {
  it("returns embedding vector for query", async () => {
    const vector = await embedQuery("test question", { apiKey: "sk-mock" });
    expect(vector).toHaveLength(1536);
  });

  it("returns empty array for empty texts batch", async () => {
    const results = await embedTexts([], { apiKey: "sk-mock" });
    expect(results).toEqual([]);
  });

  it("returns embeddings for text list", async () => {
    const results = await embedTexts(["chunk 1", "chunk 2"], {
      apiKey: "sk-mock",
    });
    expect(results).toHaveLength(2);
  });
});
