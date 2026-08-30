import type { PrismaClient } from "@/generated/prisma/client";
import prisma from "@/lib/db";
import type { TextChunk } from "./chunker";

export interface PersistChunkParam extends TextChunk {
  sourceId: string;
  revision: number;
  embedding: number[];
}

export async function persistChunksWithVectors(
  tx: { $executeRaw: PrismaClient["$executeRaw"] },
  chunks: PersistChunkParam[],
): Promise<void> {
  if (chunks.length === 0) return;

  for (const chunk of chunks) {
    const embeddingString = `[${chunk.embedding.join(",")}]`;
    await tx.$executeRaw`
      INSERT INTO "KnowledgeChunk" ("id", "sourceId", "chunkIndex", "content", "tokens", "revision", "embedding", "createdAt", "updatedAt")
      VALUES (
        gen_random_uuid()::text,
        ${chunk.sourceId},
        ${chunk.chunkIndex},
        ${chunk.content},
        ${chunk.tokens},
        ${chunk.revision},
        ${embeddingString}::vector,
        NOW(),
        NOW()
      );
    `;
  }
}

export interface SearchChunksOptions {
  userId: string;
  queryVector: number[];
  sourceIds?: string[];
  topK?: number;
  minSimilarity?: number;
}

export interface RetrievedChunk {
  id: string;
  sourceId: string;
  sourceName: string;
  sourceType: string;
  chunkIndex: number;
  content: string;
  tokens: number;
  similarity: number;
}

export async function searchKnowledgeChunks(
  options: SearchChunksOptions,
): Promise<RetrievedChunk[]> {
  const {
    userId,
    queryVector,
    sourceIds,
    topK = 4,
    minSimilarity = 0.5,
  } = options;

  const vectorString = `[${queryVector.join(",")}]`;

  const rows =
    sourceIds && sourceIds.length > 0
      ? await prisma.$queryRaw<
          Array<{
            id: string;
            sourceId: string;
            sourceName: string;
            sourceType: string;
            chunkIndex: number;
            content: string;
            tokens: number;
            similarity: number;
          }>
        >`
        SELECT
          c."id",
          c."sourceId",
          s."name" AS "sourceName",
          s."type" AS "sourceType",
          c."chunkIndex",
          c."content",
          c."tokens",
          (1 - (c."embedding" <=> ${vectorString}::vector)) AS "similarity"
        FROM "KnowledgeChunk" c
        JOIN "KnowledgeSource" s ON s."id" = c."sourceId"
        WHERE s."userId" = ${userId}
          AND s."status" = 'EMBEDDED'
          AND c."sourceId" = ANY(${sourceIds}::text[])
          AND (1 - (c."embedding" <=> ${vectorString}::vector)) >= ${minSimilarity}
        ORDER BY c."embedding" <=> ${vectorString}::vector ASC
        LIMIT ${topK};
      `
      : await prisma.$queryRaw<
          Array<{
            id: string;
            sourceId: string;
            sourceName: string;
            sourceType: string;
            chunkIndex: number;
            content: string;
            tokens: number;
            similarity: number;
          }>
        >`
        SELECT
          c."id",
          c."sourceId",
          s."name" AS "sourceName",
          s."type" AS "sourceType",
          c."chunkIndex",
          c."content",
          c."tokens",
          (1 - (c."embedding" <=> ${vectorString}::vector)) AS "similarity"
        FROM "KnowledgeChunk" c
        JOIN "KnowledgeSource" s ON s."id" = c."sourceId"
        WHERE s."userId" = ${userId}
          AND s."status" = 'EMBEDDED'
          AND (1 - (c."embedding" <=> ${vectorString}::vector)) >= ${minSimilarity}
        ORDER BY c."embedding" <=> ${vectorString}::vector ASC
        LIMIT ${topK};
      `;

  return rows.map((r) => ({
    id: r.id,
    sourceId: r.sourceId,
    sourceName: r.sourceName,
    sourceType: r.sourceType,
    chunkIndex: r.chunkIndex,
    content: r.content,
    tokens: r.tokens,
    similarity: Number(r.similarity),
  }));
}
