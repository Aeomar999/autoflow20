import { z } from "zod";
import { VECTOR_STORES } from "@/features/knowledge/server/vector-store-ids";
import type { NodeDefinition } from "@/nodes/types";
import {
  credentialIdRef,
  promptSchema,
  variableNameSchema,
} from "../../shared/config-fields";

export const configSchema = z.object({
  variableName: variableNameSchema.optional(),
  query: promptSchema(),
  sourceIds: z.string().max(1024).optional(),
  topK: z.number().int().min(1).max(20).default(4).optional(),
  minSimilarity: z.number().min(0).max(1).default(0.5).optional(),
  credentialId: credentialIdRef(),
  /**
   * (AF-M10-13) Which store to search. Absent means `internal`, so every node
   * saved before external stores existed keeps its exact behaviour.
   */
  store: z.enum(VECTOR_STORES).optional(),
  /** Pinecone credential, required when `store` is "pinecone". */
  pineconeCredentialId: credentialIdRef(),
  /**
   * Logical namespace within the index. It is always prefixed with the
   * organization id before use — a node cannot name a raw namespace, because
   * that would make reading another tenant's vectors a one-field change on a
   * shared index.
   */
  namespace: z.string().max(128).optional(),
});

export type RetrieveKnowledgeData = z.infer<typeof configSchema>;

export const definition: NodeDefinition = {
  type: "AI_RETRIEVE",
  version: 1,
  category: "AI",
  label: "Retrieve Knowledge",
  description:
    "Perform semantic similarity search over knowledge base documents and inject relevant context and citations into the workflow.",
  icon: "BookOpen",
  keywords: [
    "rag",
    "retrieval",
    "vector",
    "knowledge",
    "embedding",
    "search",
    "documents",
    "ai",
  ],
  configSchema,
  defaults: {},
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  credentials: [
    { key: "credentialId", type: "openai.apiKey", required: false },
    {
      key: "pineconeCredentialId",
      type: "pinecone.apiKey",
      required: false,
    },
  ],
};
