import "server-only";
import { NonRetriableError } from "inngest";
import { compileTemplate } from "@/features/executions/template";
import { embedQuery } from "@/features/knowledge/lib/embedder";
import { searchKnowledgeChunks } from "@/features/knowledge/lib/vector-search";
import type { NodeRun } from "@/nodes/types";
import type { RetrieveKnowledgeData } from "./definition";

export const execute: NodeRun<RetrieveKnowledgeData> = async ({
  data,
  userId,
  context,
  step,
  credentials,
}) => {
  if (!data.variableName) {
    throw new NonRetriableError(
      "Retrieve Knowledge node: Variable name is missing",
    );
  }

  if (!data.query) {
    throw new NonRetriableError("Retrieve Knowledge node: Query is missing");
  }

  const resolvedQuery = compileTemplate(data.query)(context).trim();

  if (!resolvedQuery) {
    throw new NonRetriableError(
      "Retrieve Knowledge node: Query resolved to empty string",
    );
  }

  const secret = credentials?.credentialId;
  const apiKey = secret?.apiKey;

  const sourceIdsArray = data.sourceIds
    ? compileTemplate(data.sourceIds)(context)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

  const searchResults = await step.run(
    "retrieve-knowledge-chunks",
    async () => {
      const queryVector = await embedQuery(resolvedQuery, {
        apiKey,
        credentialId: data.credentialId,
        userId,
      });

      const chunks = await searchKnowledgeChunks({
        userId,
        queryVector,
        sourceIds:
          sourceIdsArray && sourceIdsArray.length > 0
            ? sourceIdsArray
            : undefined,
        topK: data.topK ?? 4,
        minSimilarity: data.minSimilarity ?? 0.5,
      });

      return chunks;
    },
  );

  const formattedContext =
    searchResults.length > 0
      ? searchResults
          .map(
            (c) =>
              `[Source: ${c.sourceName} | Similarity: ${(c.similarity * 100).toFixed(1)}%]
${c.content}`,
          )
          .join("\n\n---\n\n")
      : "";

  const citations = searchResults.map((c) => ({
    id: c.id,
    sourceId: c.sourceId,
    sourceName: c.sourceName,
    chunkIndex: c.chunkIndex,
    similarity: c.similarity,
  }));

  return {
    ...context,
    [data.variableName]: {
      query: resolvedQuery,
      context: formattedContext,
      chunks: searchResults,
      citations,
      count: searchResults.length,
    },
  };
};
