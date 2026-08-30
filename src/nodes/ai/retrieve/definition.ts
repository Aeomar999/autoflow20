import { z } from "zod";
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
  ],
};
