import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { PAGINATION } from "@/config/constants";
import { inngest } from "@/inngest/client";
import prisma from "@/lib/db";
import { createTRPCRouter, protectedProcedure } from "@/trpc/init";
import { embedQuery } from "../lib/embedder";
import { searchKnowledgeChunks } from "../lib/vector-search";

export const knowledgeRouter = createTRPCRouter({
  list: protectedProcedure
    .input(
      z
        .object({
          page: z.number().int().min(1).default(1),
          pageSize: z
            .number()
            .int()
            .min(1)
            .max(PAGINATION.MAX_PAGE_SIZE)
            .default(PAGINATION.DEFAULT_PAGE_SIZE),
          search: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const page = input?.page ?? 1;
      const pageSize = input?.pageSize ?? PAGINATION.DEFAULT_PAGE_SIZE;
      const search = input?.search?.trim();

      const where = {
        userId: ctx.auth.user.id,
        ...(search
          ? {
              name: {
                contains: search,
                mode: "insensitive" as const,
              },
            }
          : {}),
      };

      const [items, total] = await Promise.all([
        prisma.knowledgeSource.findMany({
          where,
          orderBy: { updatedAt: "desc" },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.knowledgeSource.count({ where }),
      ]);

      const totalPages = Math.ceil(total / pageSize);

      return {
        items,
        total,
        page,
        pageSize,
        totalPages,
      };
    }),

  getOne: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const source = await prisma.knowledgeSource.findFirst({
        where: { id: input.id, userId: ctx.auth.user.id },
        include: {
          chunks: {
            orderBy: { chunkIndex: "asc" },
            take: 100,
          },
        },
      });

      if (!source) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Knowledge source not found",
        });
      }

      return source;
    }),

  createFile: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(255),
        base64Content: z.string().min(1),
        filename: z.string().min(1),
        credentialId: z.string().cuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const source = await prisma.knowledgeSource.create({
        data: {
          name: input.name,
          type: "FILE",
          mimeType: input.filename.endsWith(".pdf")
            ? "application/pdf"
            : input.filename.endsWith(".docx")
              ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              : input.filename.endsWith(".md")
                ? "text/markdown"
                : "text/plain",
          userId: ctx.auth.user.id,
          credentialId: input.credentialId,
          status: "PENDING",
        },
      });

      await inngest.send({
        name: "knowledge/source.process",
        data: {
          sourceId: source.id,
          userId: ctx.auth.user.id,
          rawContentBase64: input.base64Content,
        },
      });

      return source;
    }),

  createUrl: protectedProcedure
    .input(
      z.object({
        url: z.string().url(),
        name: z.string().min(1).max(255).optional(),
        credentialId: z.string().cuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const source = await prisma.knowledgeSource.create({
        data: {
          name: input.name || input.url,
          type: "URL",
          url: input.url,
          mimeType: "text/html",
          userId: ctx.auth.user.id,
          credentialId: input.credentialId,
          status: "PENDING",
        },
      });

      await inngest.send({
        name: "knowledge/source.process",
        data: {
          sourceId: source.id,
          userId: ctx.auth.user.id,
        },
      });

      return source;
    }),

  createText: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(255),
        content: z.string().min(1),
        credentialId: z.string().cuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const source = await prisma.knowledgeSource.create({
        data: {
          name: input.name,
          type: "TEXT",
          mimeType: "text/plain",
          userId: ctx.auth.user.id,
          credentialId: input.credentialId,
          status: "PENDING",
        },
      });

      const base64Content = Buffer.from(input.content, "utf-8").toString(
        "base64",
      );

      await inngest.send({
        name: "knowledge/source.process",
        data: {
          sourceId: source.id,
          userId: ctx.auth.user.id,
          rawContentBase64: base64Content,
        },
      });

      return source;
    }),

  reindex: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const source = await prisma.knowledgeSource.findFirst({
        where: { id: input.id, userId: ctx.auth.user.id },
      });

      if (!source) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Knowledge source not found",
        });
      }

      await prisma.knowledgeSource.update({
        where: { id: source.id },
        data: { status: "PENDING", errorMessage: null },
      });

      await inngest.send({
        name: "knowledge/source.process",
        data: {
          sourceId: source.id,
          userId: ctx.auth.user.id,
        },
      });

      return { ok: true, id: source.id };
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const source = await prisma.knowledgeSource.findFirst({
        where: { id: input.id, userId: ctx.auth.user.id },
      });

      if (!source) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Knowledge source not found",
        });
      }

      await prisma.knowledgeSource.delete({
        where: { id: input.id },
      });

      return { ok: true, id: input.id };
    }),

  testQuery: protectedProcedure
    .input(
      z.object({
        query: z.string().min(1),
        sourceIds: z.array(z.string()).optional(),
        topK: z.number().int().min(1).max(20).default(4).optional(),
        minSimilarity: z.number().min(0).max(1).default(0.5).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const queryVector = await embedQuery(input.query, {
        userId: ctx.auth.user.id,
      });

      const results = await searchKnowledgeChunks({
        userId: ctx.auth.user.id,
        queryVector,
        sourceIds: input.sourceIds,
        topK: input.topK ?? 4,
        minSimilarity: input.minSimilarity ?? 0.5,
      });

      return { results };
    }),
});
