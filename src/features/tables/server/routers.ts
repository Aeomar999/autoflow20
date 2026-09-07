import { createId } from "@paralleldrive/cuid2";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { PAGINATION } from "@/config/constants";
import prisma from "@/lib/db";
import {
  createTRPCRouter,
  orgEditorProcedure,
  orgViewerProcedure,
} from "@/trpc/init";

export const tablesRouter = createTRPCRouter({
  createTable: orgEditorProcedure
    .input(
      z.object({
        name: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const table = await prisma.workspaceTable.create({
        data: {
          id: createId(),
          organizationId: ctx.org.id,
          name: input.name,
        },
      });
      return table;
    }),

  listTables: orgViewerProcedure.query(async ({ ctx }) => {
    return prisma.workspaceTable.findMany({
      where: { organizationId: ctx.org.id },
      orderBy: { createdAt: "desc" },
    });
  }),

  getTable: orgViewerProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const table = await prisma.workspaceTable.findUnique({
        where: { id: input.id, organizationId: ctx.org.id },
      });
      if (!table) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Table not found" });
      }
      return table;
    }),

  updateTable: orgEditorProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const table = await prisma.workspaceTable.update({
        where: { id: input.id, organizationId: ctx.org.id },
        data: { name: input.name },
      });
      return table;
    }),

  deleteTable: orgEditorProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await prisma.workspaceTable.delete({
        where: { id: input.id, organizationId: ctx.org.id },
      });
      return { success: true };
    }),

  insertRecord: orgEditorProcedure
    .input(
      z.object({
        tableId: z.string(),
        data: z.record(z.unknown()),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const record = await prisma.workspaceRecord.create({
        data: {
          id: createId(),
          tableId: input.tableId,
          organizationId: ctx.org.id,
          data: input.data as any,
        },
      });
      return record;
    }),

  listRecords: orgViewerProcedure
    .input(
      z.object({
        tableId: z.string(),
        cursor: z.string().nullish(),
      })
    )
    .query(async ({ ctx, input }) => {
      const limit = PAGINATION.DEFAULT_PAGE_SIZE;
      const records = await prisma.workspaceRecord.findMany({
        take: limit + 1,
        cursor: input.cursor ? { id: input.cursor } : undefined,
        where: { tableId: input.tableId, organizationId: ctx.org.id },
        orderBy: { createdAt: "desc" },
      });

      let nextCursor: typeof input.cursor = undefined;
      if (records.length > limit) {
        const nextItem = records.pop();
        nextCursor = nextItem!.id;
      }

      return {
        items: records,
        nextCursor,
      };
    }),

  deleteRecord: orgEditorProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await prisma.workspaceRecord.delete({
        where: { id: input.id, organizationId: ctx.org.id },
      });
      return { success: true };
    }),
});
