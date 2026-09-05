import "server-only";
import { NonRetriableError } from "inngest";
import type { CredentialSecret } from "@/features/credentials/server/vault";
import { searchKnowledgeChunks } from "../lib/vector-search";
import type { VectorStoreId } from "./vector-store-ids";

/**
 * Vector stores behind one interface (AF-M10-13).
 *
 * `AI_RETRIEVE` was bound to the internal `KnowledgeChunk` table. Automation
 * #23 ("chat with your PDF" on Telegram) needs a **caller-supplied** Pinecone
 * index at 768 dimensions — the user already has the vectors and does not want
 * to re-ingest them into ours.
 *
 * Two implementations, one contract. The internal store stays the default, so
 * no saved `AI_RETRIEVE` node changes behaviour.
 */

export { VECTOR_STORES, type VectorStoreId } from "./vector-store-ids";

export interface VectorMatch {
  id: string;
  /** Cosine similarity in [0, 1]. */
  similarity: number;
  /** The chunk text, when the store holds it. */
  content: string;
  /** Where it came from, for citations. */
  sourceId: string;
  sourceName: string;
  chunkIndex: number;
}

export interface VectorQuery {
  vector: number[];
  topK: number;
  minSimilarity: number;
  /** Restrict to specific sources; store-specific interpretation. */
  sourceIds?: string[];
}

export interface VectorUpsertItem {
  id: string;
  vector: number[];
  content: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface VectorStore {
  readonly id: VectorStoreId;
  /** Vectors this store expects, when it can say. Null when it cannot. */
  dimensions(): Promise<number | null>;
  query(query: VectorQuery): Promise<VectorMatch[]>;
  upsert(items: VectorUpsertItem[]): Promise<{ upserted: number }>;
  remove(ids: string[]): Promise<{ deleted: number }>;
}

export class VectorStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VectorStoreError";
  }
}

// ---------------------------------------------------------------------------
// Internal (pgvector `KnowledgeChunk`)
// ---------------------------------------------------------------------------

/**
 * The store AutoFlow already had. Read-only through this interface: writes go
 * through the knowledge-base ingestion pipeline, which owns chunking, revision
 * bookkeeping and source status — none of which a generic `upsert` could
 * honour, and a half-written source is worse than an unsupported operation.
 */
export class InternalVectorStore implements VectorStore {
  readonly id = "internal" as const;

  constructor(private readonly userId: string) {}

  async dimensions(): Promise<number | null> {
    // Fixed by the embedding model the ingestion pipeline uses
    // (`text-embedding-3-small`).
    return 1536;
  }

  async query(query: VectorQuery): Promise<VectorMatch[]> {
    const chunks = await searchKnowledgeChunks({
      userId: this.userId,
      queryVector: query.vector,
      sourceIds:
        query.sourceIds && query.sourceIds.length > 0
          ? query.sourceIds
          : undefined,
      topK: query.topK,
      minSimilarity: query.minSimilarity,
    });

    return chunks.map((chunk) => ({
      id: chunk.id,
      similarity: chunk.similarity,
      content: chunk.content,
      sourceId: chunk.sourceId,
      sourceName: chunk.sourceName,
      chunkIndex: chunk.chunkIndex,
    }));
  }

  async upsert(): Promise<{ upserted: number }> {
    throw new VectorStoreError(
      "The internal knowledge base is written through document ingestion, not by a node. Add a source under Knowledge, or point this node at an external store.",
    );
  }

  async remove(): Promise<{ deleted: number }> {
    throw new VectorStoreError(
      "The internal knowledge base is managed under Knowledge, not by a node.",
    );
  }
}

// ---------------------------------------------------------------------------
// Pinecone
// ---------------------------------------------------------------------------

interface PineconeMatch {
  id: string;
  score?: number;
  metadata?: Record<string, unknown>;
}

/**
 * A caller-supplied Pinecone index, over its REST API.
 *
 * No SDK: the three operations used here are three POSTs, and the official
 * client brings a dependency tree and its own retry semantics that would sit
 * awkwardly beside the engine's (AF-M9-06 owns retries).
 *
 * **Namespaces are org-scoped and the caller does not choose the prefix.** A
 * namespace is the only isolation Pinecone offers inside an index, and letting
 * a node config name one raw would make "read another tenant's namespace" a
 * one-field change on a shared index.
 */
export class PineconeVectorStore implements VectorStore {
  readonly id = "pinecone" as const;

  private readonly indexHost: string;
  private readonly apiKey: string;
  private readonly namespace: string;

  constructor(args: {
    secret: CredentialSecret;
    organizationId: string;
    /** Caller's logical namespace; prefixed with the org, never used raw. */
    namespace?: string;
  }) {
    const apiKey = args.secret.apiKey;
    const host = args.secret.indexHost;

    if (!apiKey) {
      throw new VectorStoreError("The Pinecone credential has no API key.");
    }
    if (!host) {
      throw new VectorStoreError(
        "The Pinecone credential has no index host. Copy it from the index's page in the Pinecone console (it looks like my-index-abc123.svc.us-east-1-aws.pinecone.io).",
      );
    }

    this.apiKey = apiKey;
    this.indexHost = host.startsWith("http") ? host : `https://${host}`;
    this.namespace = PineconeVectorStore.scopedNamespace(
      args.organizationId,
      args.namespace,
    );
  }

  /**
   * `org_<id>` or `org_<id>__<name>`.
   *
   * The org prefix is structural. Two tenants pointed at the same index — which
   * happens, because an index is a billed resource people share — are separated
   * by it, and no node config can reach outside its own prefix.
   */
  static scopedNamespace(organizationId: string, namespace?: string): string {
    const suffix = (namespace ?? "").trim().replace(/[^A-Za-z0-9_-]/g, "");
    return suffix.length > 0
      ? `org_${organizationId}__${suffix}`
      : `org_${organizationId}`;
  }

  private async call<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${this.indexHost}${path}`, {
      method: "POST",
      headers: {
        "Api-Key": this.apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Pinecone-API-Version": "2025-01",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });

    const text = await response.text();
    if (!response.ok) {
      throw new VectorStoreError(
        `Pinecone returned ${response.status}: ${text.slice(0, 300)}`,
      );
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new VectorStoreError(
        "Pinecone returned a response that is not JSON.",
      );
    }
  }

  async dimensions(): Promise<number | null> {
    // `describe_index_stats` is on the data plane, same host and key.
    try {
      const stats = await this.call<{ dimension?: number }>(
        "/describe_index_stats",
        {},
      );
      return typeof stats.dimension === "number" ? stats.dimension : null;
    } catch {
      // A stats call that fails should not stop a query from being attempted;
      // the dimension check is a better error, not a required one.
      return null;
    }
  }

  async query(query: VectorQuery): Promise<VectorMatch[]> {
    const response = await this.call<{ matches?: PineconeMatch[] }>("/query", {
      namespace: this.namespace,
      vector: query.vector,
      topK: query.topK,
      includeMetadata: true,
      includeValues: false,
    });

    return (
      (response.matches ?? [])
        .map((match) => {
          const metadata = match.metadata ?? {};
          return {
            id: match.id,
            // Pinecone returns cosine similarity directly for cosine indexes.
            similarity: typeof match.score === "number" ? match.score : 0,
            content:
              typeof metadata.content === "string"
                ? metadata.content
                : typeof metadata.text === "string"
                  ? metadata.text
                  : "",
            sourceId:
              typeof metadata.sourceId === "string"
                ? metadata.sourceId
                : match.id,
            sourceName:
              typeof metadata.sourceName === "string"
                ? metadata.sourceName
                : typeof metadata.source === "string"
                  ? metadata.source
                  : "Pinecone",
            chunkIndex:
              typeof metadata.chunkIndex === "number" ? metadata.chunkIndex : 0,
          };
        })
        // Applied here rather than sent to Pinecone, which has no similarity
        // floor — so the same `minSimilarity` means the same thing in both stores.
        .filter((match) => match.similarity >= query.minSimilarity)
    );
  }

  async upsert(items: VectorUpsertItem[]): Promise<{ upserted: number }> {
    if (items.length === 0) {
      return { upserted: 0 };
    }

    // AF-M10-13: check the index's dimension BEFORE the first write, and name
    // both numbers. #23's stated prerequisite is a 768-dimension index, and
    // "vector dimension 1536 does not match" with no mention of which is
    // which is exactly the error people lose an afternoon to.
    const expected = await this.dimensions();
    const actual = items[0].vector.length;
    if (expected !== null && expected !== actual) {
      throw new VectorStoreError(
        `The Pinecone index expects ${expected}-dimension vectors but these embeddings are ${actual}-dimension. ` +
          "Use an embedding model that matches the index, or create an index with the right dimension.",
      );
    }

    const response = await this.call<{ upsertedCount?: number }>(
      "/vectors/upsert",
      {
        namespace: this.namespace,
        vectors: items.map((item) => ({
          id: item.id,
          values: item.vector,
          metadata: { content: item.content, ...(item.metadata ?? {}) },
        })),
      },
    );

    return { upserted: response.upsertedCount ?? items.length };
  }

  async remove(ids: string[]): Promise<{ deleted: number }> {
    if (ids.length === 0) {
      return { deleted: 0 };
    }
    await this.call("/vectors/delete", { namespace: this.namespace, ids });
    return { deleted: ids.length };
  }
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

export function resolveVectorStore(args: {
  store: VectorStoreId | undefined;
  userId: string;
  organizationId?: string;
  namespace?: string;
  secret?: CredentialSecret;
}): VectorStore {
  // Absent means internal, so every node saved before AF-M10-13 keeps its
  // exact behaviour.
  const id = args.store ?? "internal";

  if (id === "internal") {
    return new InternalVectorStore(args.userId);
  }

  if (!args.organizationId) {
    throw new NonRetriableError(
      "Retrieve Knowledge node: an external vector store needs an organization to scope its namespace, and this run has none.",
    );
  }
  if (!args.secret) {
    throw new NonRetriableError(
      "Retrieve Knowledge node: no Pinecone credential is bound to this node.",
    );
  }

  try {
    return new PineconeVectorStore({
      secret: args.secret,
      organizationId: args.organizationId,
      namespace: args.namespace,
    });
  } catch (error) {
    throw new NonRetriableError(
      `Retrieve Knowledge node: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
