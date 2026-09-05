import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { searchKnowledgeChunks } = vi.hoisted(() => ({
  searchKnowledgeChunks: vi.fn(async () => []),
}));

vi.mock("@/features/knowledge/lib/vector-search", () => ({
  searchKnowledgeChunks,
}));

import {
  InternalVectorStore,
  PineconeVectorStore,
  resolveVectorStore,
  VectorStoreError,
} from "./vector-store";

const pineconeSecret = {
  apiKey: "pc_live_key",
  indexHost: "my-index-abc.svc.us-east-1-aws.pinecone.io",
};

/** Captures what the store sent, and answers with what the test wants. */
function stubPinecone(responses: Record<string, unknown>): {
  calls: Array<{ path: string; body: Record<string, unknown> }>;
} {
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  vi.spyOn(globalThis, "fetch").mockImplementation((async (
    url: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const path = new URL(String(url)).pathname;
    calls.push({
      path,
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    });
    return new Response(JSON.stringify(responses[path] ?? {}), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch);
  return { calls };
}

describe("PineconeVectorStore namespaces (AF-M10-13)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("prefixes every namespace with the organization", () => {
    // A namespace is the only isolation Pinecone offers inside an index, and
    // an index is a billed resource people share across tenants.
    expect(PineconeVectorStore.scopedNamespace("org_a")).toBe("org_org_a");
    expect(PineconeVectorStore.scopedNamespace("org_a", "invoices")).toBe(
      "org_org_a__invoices",
    );
  });

  it("gives two organizations different namespaces for the same name", () => {
    // The acceptance: one org cannot query another's namespace.
    expect(PineconeVectorStore.scopedNamespace("org_a", "shared")).not.toBe(
      PineconeVectorStore.scopedNamespace("org_b", "shared"),
    );
  });

  it("cannot be escaped by a crafted namespace in node config", () => {
    // Without stripping, "..__org_b" or a leading separator would let a node
    // config address another tenant's namespace directly.
    const escaped = PineconeVectorStore.scopedNamespace(
      "org_a",
      "../org_b__secrets",
    );
    expect(escaped.startsWith("org_org_a__")).toBe(true);
    expect(escaped).not.toContain("/");
    expect(escaped).not.toContain("..");
  });

  it("sends the scoped namespace on every query", async () => {
    const { calls } = stubPinecone({
      "/query": { matches: [{ id: "v1", score: 0.9, metadata: {} }] },
    });

    const store = new PineconeVectorStore({
      secret: pineconeSecret,
      organizationId: "org_a",
      namespace: "invoices",
    });
    await store.query({ vector: [0.1, 0.2], topK: 3, minSimilarity: 0 });

    expect(calls[0].body.namespace).toBe("org_org_a__invoices");
  });
});

describe("PineconeVectorStore (AF-M10-13)", () => {
  afterEach(() => vi.restoreAllMocks());

  const store = () =>
    new PineconeVectorStore({
      secret: pineconeSecret,
      organizationId: "org_a",
    });

  it("refuses a credential with no index host, saying where to find it", () => {
    expect(
      () =>
        new PineconeVectorStore({
          secret: { apiKey: "k" },
          organizationId: "org_a",
        }),
    ).toThrow(/index host/i);
  });

  it("maps matches into the shared shape, preferring metadata content", async () => {
    stubPinecone({
      "/query": {
        matches: [
          {
            id: "v1",
            score: 0.91,
            metadata: {
              content: "Payment terms are net 30.",
              sourceName: "MSA.pdf",
              sourceId: "src_1",
              chunkIndex: 4,
            },
          },
        ],
      },
    });

    const matches = await store().query({
      vector: [0.1],
      topK: 5,
      minSimilarity: 0,
    });

    expect(matches).toEqual([
      {
        id: "v1",
        similarity: 0.91,
        content: "Payment terms are net 30.",
        sourceId: "src_1",
        sourceName: "MSA.pdf",
        chunkIndex: 4,
      },
    ]);
  });

  it("applies minSimilarity itself, since Pinecone has no floor", async () => {
    // Otherwise the same setting would mean different things in the two
    // stores, and a template ported between them would quietly change.
    stubPinecone({
      "/query": {
        matches: [
          { id: "hi", score: 0.8, metadata: {} },
          { id: "lo", score: 0.2, metadata: {} },
        ],
      },
    });

    const matches = await store().query({
      vector: [0.1],
      topK: 5,
      minSimilarity: 0.5,
    });
    expect(matches.map((m) => m.id)).toEqual(["hi"]);
  });

  it("names both numbers when the index dimension does not match", async () => {
    // #23's stated prerequisite is a 768-dimension index. "Vector dimension
    // 1536 does not match" without saying which is which is the error people
    // lose an afternoon to.
    stubPinecone({
      "/describe_index_stats": { dimension: 768 },
      "/vectors/upsert": { upsertedCount: 1 },
    });

    await expect(
      store().upsert([
        { id: "v1", vector: new Array(1536).fill(0.1), content: "x" },
      ]),
    ).rejects.toThrow(/768.*1536|1536.*768/);
  });

  it("checks the dimension BEFORE writing anything", async () => {
    const { calls } = stubPinecone({
      "/describe_index_stats": { dimension: 768 },
    });

    await expect(
      store().upsert([
        { id: "v1", vector: new Array(1536).fill(0.1), content: "x" },
      ]),
    ).rejects.toBeInstanceOf(VectorStoreError);

    expect(calls.map((c) => c.path)).not.toContain("/vectors/upsert");
  });

  it("upserts when the dimension matches", async () => {
    const { calls } = stubPinecone({
      "/describe_index_stats": { dimension: 3 },
      "/vectors/upsert": { upsertedCount: 1 },
    });

    const result = await store().upsert([
      { id: "v1", vector: [0.1, 0.2, 0.3], content: "hello" },
    ]);

    expect(result).toEqual({ upserted: 1 });
    const upsert = calls.find((c) => c.path === "/vectors/upsert");
    expect(upsert?.body.namespace).toBe("org_org_a");
  });

  it("surfaces a provider error rather than returning nothing", async () => {
    // Returning [] on a 403 looks exactly like "no relevant context", and the
    // model then answers confidently from nothing.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("forbidden", { status: 403 }),
    );
    await expect(
      store().query({ vector: [0.1], topK: 1, minSimilarity: 0 }),
    ).rejects.toThrow(/403/);
  });
});

describe("resolveVectorStore (AF-M10-13)", () => {
  beforeEach(() => searchKnowledgeChunks.mockClear());

  it("defaults to the internal store, so saved nodes do not change", () => {
    const store = resolveVectorStore({ store: undefined, userId: "user_1" });
    expect(store).toBeInstanceOf(InternalVectorStore);
    expect(store.id).toBe("internal");
  });

  it("refuses an external store with no organization to scope it", () => {
    expect(() =>
      resolveVectorStore({
        store: "pinecone",
        userId: "user_1",
        secret: pineconeSecret,
      }),
    ).toThrow(/organization/i);
  });

  it("refuses an external store with no credential bound", () => {
    expect(() =>
      resolveVectorStore({
        store: "pinecone",
        userId: "user_1",
        organizationId: "org_a",
      }),
    ).toThrow(/no Pinecone credential/i);
  });

  it("routes the internal store's query to the existing pgvector search", async () => {
    const store = resolveVectorStore({ store: "internal", userId: "user_1" });
    await store.query({ vector: [0.1], topK: 2, minSimilarity: 0.4 });
    expect(searchKnowledgeChunks).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user_1", topK: 2 }),
    );
  });

  it("refuses to write to the internal store from a node", async () => {
    // Ingestion owns chunking, revisions and source status; a half-written
    // source is worse than an unsupported operation.
    const store = resolveVectorStore({ store: "internal", userId: "user_1" });
    await expect(
      store.upsert([{ id: "a", vector: [0.1], content: "x" }]),
    ).rejects.toThrow(/document ingestion/i);
  });
});
