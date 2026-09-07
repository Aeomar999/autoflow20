import "server-only";
import type { NodeRun } from "@/nodes/types";
import prisma from "@/lib/db";
import { configSchema } from "./definition";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";

type DataTableConfig = z.infer<typeof configSchema>;

export const execute: NodeRun<DataTableConfig> = async ({
  data,
  context,
  organizationId,
  resolve,
}) => {
  if (!organizationId) {
    throw new Error(
      "Tenant context is required for Workspace Table operations.",
    );
  }

  // data is already validated when saving, but we can double check or just use it
  const config = configSchema.parse(data);

  // Verify table exists and belongs to the org
  const table = await prisma.workspaceTable.findUnique({
    where: { id: config.tableId, organizationId },
  });
  if (!table) {
    throw new Error("Table not found or access denied.");
  }

  const { action } = config;

  if (action === "insert") {
    const payload: Record<string, unknown> = {};
    if (config.data) {
      for (const field of config.data) {
        payload[field.key] = resolve(field.value);
      }
    }

    const record = await prisma.workspaceRecord.create({
      data: {
        tableId: table.id,
        organizationId,
        data: payload as Prisma.InputJsonValue,
      },
    });

    return { ...context, [config.variableName]: record };
  }

  if (action === "update") {
    if (!config.recordId)
      throw new Error("recordId is required for update action");
    const recordId = resolve(config.recordId);

    // Check ownership
    const existing = await prisma.workspaceRecord.findUnique({
      where: { id: String(recordId), organizationId, tableId: table.id },
    });
    if (!existing) throw new Error("Record not found or access denied.");

    const payload: Record<string, unknown> =
      (existing.data as Record<string, unknown>) || {};
    if (config.data) {
      for (const field of config.data) {
        payload[field.key] = resolve(field.value);
      }
    }

    const record = await prisma.workspaceRecord.update({
      where: { id: String(recordId) },
      data: { data: payload as Prisma.InputJsonValue },
    });

    return { ...context, [config.variableName]: record };
  }

  if (action === "find") {
    if (!config.recordId)
      throw new Error("recordId is required for find action");
    const recordId = resolve(config.recordId);

    const record = await prisma.workspaceRecord.findUnique({
      where: { id: String(recordId), organizationId, tableId: table.id },
    });
    if (!record) throw new Error("Record not found.");

    return { ...context, [config.variableName]: record };
  }

  if (action === "find_many") {
    const records = await prisma.workspaceRecord.findMany({
      where: { organizationId, tableId: table.id },
      take: 100, // Hard limit for safety in v1
      orderBy: { createdAt: "desc" },
    });

    return { ...context, [config.variableName]: records };
  }

  if (action === "delete") {
    if (!config.recordId)
      throw new Error("recordId is required for delete action");
    const recordId = resolve(config.recordId);

    // Check ownership
    const existing = await prisma.workspaceRecord.findUnique({
      where: { id: String(recordId), organizationId, tableId: table.id },
    });
    if (!existing) throw new Error("Record not found or access denied.");

    await prisma.workspaceRecord.delete({
      where: { id: String(recordId) },
    });

    return {
      ...context,
      [config.variableName]: { success: true, id: recordId },
    };
  }

  throw new Error(`Unsupported action: ${action}`);
};
