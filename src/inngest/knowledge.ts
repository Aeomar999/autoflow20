import { chunkText } from "@/features/knowledge/lib/chunker";
import { embedTexts } from "@/features/knowledge/lib/embedder";
import {
  extractTextFromBuffer,
  extractTextFromUrl,
} from "@/features/knowledge/lib/extractor";
import { persistChunksWithVectors } from "@/features/knowledge/lib/vector-search";
import prisma from "@/lib/db";
import { inngest } from "./client";

export const processKnowledgeSource = inngest.createFunction(
  {
    id: "process-knowledge-source",
    name: "Process Knowledge Source Ingestion",
    retries: 3,
  },
  { event: "knowledge/source.process" },
  async ({ event, step }) => {
    const { sourceId, userId, rawContentBase64 } = event.data;

    const source = await step.run("fetch-source", async () => {
      const found = await prisma.knowledgeSource.findFirst({
        where: { id: sourceId, userId },
      });
      if (!found)
        throw new Error(`KnowledgeSource "${sourceId}" not found for user`);
      return found;
    });

    await step.run("mark-processing", async () => {
      await prisma.knowledgeSource.update({
        where: { id: sourceId },
        data: { status: "PROCESSING", errorMessage: null },
      });
    });

    try {
      const extracted = await step.run("extract-text", async () => {
        if (source.type === "URL" && source.url) {
          return await extractTextFromUrl(source.url);
        }

        if (source.type === "FILE" && rawContentBase64) {
          const buffer = Buffer.from(rawContentBase64, "base64");
          return await extractTextFromBuffer(
            buffer,
            source.mimeType || source.name,
          );
        }

        if (source.type === "TEXT" && rawContentBase64) {
          const buffer = Buffer.from(rawContentBase64, "base64");
          return await extractTextFromBuffer(buffer, "document.txt");
        }

        throw new Error("Missing content or URL to extract text from");
      });

      const chunks = await step.run("chunk-text", async () => {
        return chunkText(extracted.text, {
          maxChunkCharacters: 1000,
          overlapCharacters: 150,
        });
      });

      if (chunks.length === 0) {
        throw new Error(
          "No readable text could be extracted from this document",
        );
      }

      const embeddings = await step.run("generate-embeddings", async () => {
        const textList = chunks.map((c) => c.content);
        return await embedTexts(textList, {
          credentialId: source.credentialId ?? undefined,
          userId,
        });
      });

      const nextRevision = source.revision + 1;
      const totalTokens = chunks.reduce((sum, c) => sum + c.tokens, 0);

      await step.run("persist-chunks-and-update-source", async () => {
        await prisma.$transaction(async (tx) => {
          await tx.knowledgeChunk.deleteMany({
            where: { sourceId },
          });

          const chunksWithVectors = chunks.map((c, i) => ({
            ...c,
            sourceId,
            revision: nextRevision,
            embedding: embeddings[i],
          }));

          await persistChunksWithVectors(tx, chunksWithVectors);

          await tx.knowledgeSource.update({
            where: { id: sourceId },
            data: {
              status: "EMBEDDED",
              errorMessage: null,
              revision: nextRevision,
              chunkCount: chunks.length,
              tokenCount: totalTokens,
              sizeBytes: extracted.sizeBytes,
              mimeType: extracted.mimeType || source.mimeType,
            },
          });
        });
      });

      return {
        sourceId,
        status: "EMBEDDED",
        chunksCount: chunks.length,
        totalTokens,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown ingestion error";
      await step.run("mark-failed", async () => {
        await prisma.knowledgeSource.update({
          where: { id: sourceId },
          data: {
            status: "FAILED",
            errorMessage,
          },
        });
      });
      throw error;
    }
  },
);

export const scheduledKnowledgeSync = inngest.createFunction(
  {
    id: "scheduled-knowledge-sync",
    name: "Sync Outdated URL Knowledge Sources",
  },
  { cron: "0 2 * * *" },
  async ({ step }) => {
    const urlSources = await step.run("list-url-sources", async () => {
      return prisma.knowledgeSource.findMany({
        where: { type: "URL", status: "EMBEDDED" },
        select: { id: true, userId: true },
      });
    });

    for (const source of urlSources) {
      await inngest.send({
        name: "knowledge/source.process",
        data: {
          sourceId: source.id,
          userId: source.userId,
        },
      });
    }

    return { syncedCount: urlSources.length };
  },
);
