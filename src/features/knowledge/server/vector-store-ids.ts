/**
 * Vector store ids (AF-M10-13), isomorphic.
 *
 * Separated from `vector-store.ts` because that module is `server-only` — it
 * talks to pgvector and to Pinecone — while `AI_RETRIEVE`'s definition is in
 * the client bundle and needs the enum for its config schema.
 */
export const VECTOR_STORES = ["internal", "pinecone"] as const;
export type VectorStoreId = (typeof VECTOR_STORES)[number];
