import { z } from "zod";
import prisma from "@/lib/db";
import { orgProcedure, router } from "@/trpc/init";

const columnSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["string", "number", "boolean", "date", "json"]),
});

export const tablesRouter = router({
  listTables: orgProcedure.query(async ({ ctx }) => {
    return prisma.workspaceTable.findMany({
      where: { organizationId: ctx.organizationId },
      orderBy: { createdAt: "desc" },
    });
  }),

  getTable: orgProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const table = await prisma.workspaceTable.findUnique({
        where: { id: input.id, organizationId: ctx.organizationId },
      });
      if (!table) throw new Error("Table not found");
      return table;
    }),

  createTable: orgProcedure
    .input(
      z.object({
        name: z.string().min(1),
        description: z.string().optional(),
        columns: z.array(columnSchema).default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return prisma.workspaceTable.create({
        data: {
          organizationId: ctx.organizationId,
          name: input.name,
          description: input.description,
          columns: input.columns,
        },
      });
    }),

  updateTable: orgProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().optional(),
        description: z.string().optional(),
        columns: z.array(columnSchema).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      // ensure it exists and belongs to org
      const existing = await prisma.workspaceTable.findUnique({
        where: { id, organizationId: ctx.organizationId },
      });
      if (!existing) throw new Error("Table not found");

      return prisma.workspaceTable.update({
        where: { id },
        data,
      });
    }),

  deleteTable: orgProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await prisma.workspaceTable.findUnique({
        where: { id: input.id, organizationId: ctx.organizationId },
      });
      if (!existing) throw new Error("Table not found");

      return prisma.workspaceTable.delete({
        where: { id: input.id },
      });
    }),

  // RECORDS
  listRecords: orgProcedure
    .input(z.object({ tableId: z.string() }))
    .query(async ({ ctx, input }) => {
      return prisma.workspaceRecord.findMany({
        where: { tableId: input.tableId, organizationId: ctx.organizationId },
        orderBy: { createdAt: "desc" },
      });
    }),

  createRecord: orgProcedure
    .input(
      z.object({
        tableId: z.string(),
        data: z.record(z.any()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const table = await prisma.workspaceTable.findUnique({
        where: { id: input.tableId, organizationId: ctx.organizationId },
      });
      if (!table) throw new Error("Table not found");

      return prisma.workspaceRecord.create({
        data: {
          tableId: input.tableId,
          organizationId: ctx.organizationId,
          data: input.data,
        },
      });
    }),

  updateRecord: orgProcedure
    .input(
      z.object({
        id: z.string(),
        tableId: z.string(),
        data: z.record(z.any()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await prisma.workspaceRecord.findUnique({
        where: {
          id: input.id,
          tableId: input.tableId,
          organizationId: ctx.organizationId,
        },
      });
      if (!existing) throw new Error("Record not found");

      return prisma.workspaceRecord.update({
        where: { id: input.id },
        data: { data: input.data },
      });
    }),

  deleteRecord: orgProcedure
    .input(z.object({ id: z.string(), tableId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await prisma.workspaceRecord.findUnique({
        where: {
          id: input.id,
          tableId: input.tableId,
          organizationId: ctx.organizationId,
        },
      });
      if (!existing) throw new Error("Record not found");

      return prisma.workspaceRecord.delete({
        where: { id: input.id },
      });
    }),
});
