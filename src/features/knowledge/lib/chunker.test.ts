import { describe, expect, it } from "vitest";
import { chunkText, estimateTokens } from "./chunker";

describe("chunkText", () => {
  it("returns empty array for empty string", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   ")).toEqual([]);
  });

  it("returns a single chunk when content is within maxChunkCharacters", () => {
    const text = "Hello world! This is a short test document.";
    const chunks = chunkText(text, { maxChunkCharacters: 500 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe(text);
    expect(chunks[0].chunkIndex).toBe(0);
    expect(chunks[0].tokens).toBe(estimateTokens(text));
  });

  it("splits paragraphs across chunks when exceeding size", () => {
    const p1 = "A".repeat(300);
    const p2 = "B".repeat(300);
    const p3 = "C".repeat(300);
    const fullText = `${p1}\n\n${p2}\n\n${p3}`;

    const chunks = chunkText(fullText, {
      maxChunkCharacters: 400,
      overlapCharacters: 50,
    });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].chunkIndex).toBe(0);
    expect(chunks[1].chunkIndex).toBe(1);
  });

  it("maintains sequential chunk indices", () => {
    const text = Array.from(
      { length: 10 },
      (_, i) => `Paragraph ${i}: ${"x".repeat(200)}`,
    ).join("\n\n");
    const chunks = chunkText(text, { maxChunkCharacters: 300 });

    chunks.forEach((chunk, i) => {
      expect(chunk.chunkIndex).toBe(i);
    });
  });

  it("estimates tokens accurately", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("12345678")).toBe(2);
  });
});
