import { describe, expect, it, vi } from "vitest";

vi.mock("@/features/knowledge/lib/embedder", () => ({
  embedQuery: vi
    .fn()
    .mockResolvedValue(Array.from({ length: 1536 }, () => 0.01)),
}));

vi.mock("@/features/knowledge/lib/vector-search", () => ({
  searchKnowledgeChunks: vi.fn().mockResolvedValue([
    {
      id: "chunk_1",
      sourceId: "src_1",
      sourceName: "API Guide",
      sourceType: "FILE",
      chunkIndex: 0,
      content: "AutoFlow supports background RAG retrieval.",
      tokens: 7,
      similarity: 0.92,
    },
  ]),
}));

import { withResolve } from "@/nodes/shared/test-params";
import { execute } from "./execute";

describe("AI_RETRIEVE execute", () => {
  const step = {
    run: vi.fn(async (_name, fn) => fn()),
  } as unknown as Parameters<typeof execute>[0]["step"];

  it("throws NonRetriableError if variableName is missing", async () => {
    await expect(
      execute(
        withResolve({
          data: { query: "test" } as unknown as Parameters<
            typeof execute
          >[0]["data"],
          nodeId: "n1",
          userId: "u1",
          context: {},
          step,
          publish: vi.fn(),
        }),
      ),
    ).rejects.toThrow(/Variable name is missing/);
  });

  it("throws NonRetriableError if query is missing", async () => {
    await expect(
      execute(
        withResolve({
          data: { variableName: "docs" } as unknown as Parameters<
            typeof execute
          >[0]["data"],
          nodeId: "n1",
          userId: "u1",
          context: {},
          step,
          publish: vi.fn(),
        }),
      ),
    ).rejects.toThrow(/Query is missing/);
  });

  it("executes vector retrieval and writes formatted context and citations", async () => {
    const result = await execute(
      withResolve({
        data: {
          variableName: "docs",
          query: "What is AutoFlow?",
          topK: 4,
          minSimilarity: 0.6,
        },
        nodeId: "n1",
        userId: "u1",
        context: { previous: "data" },
        step,
        publish: vi.fn(),
      }),
    );

    const docs = (result as Record<string, unknown>).docs as {
      query: string;
      count: number;
      context: string;
      citations: Array<{ sourceName: string }>;
    };
    expect(docs).toBeDefined();
    expect(docs.query).toBe("What is AutoFlow?");
    expect(docs.count).toBe(1);
    expect(docs.context).toContain("API Guide");
    expect(docs.context).toContain(
      "AutoFlow supports background RAG retrieval.",
    );
    expect(docs.citations).toHaveLength(1);
    expect(docs.citations[0]?.sourceName).toBe("API Guide");
  });
});
