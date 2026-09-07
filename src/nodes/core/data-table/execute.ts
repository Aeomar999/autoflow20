import "server-only";
import type { NodeExecutionContext } from "@/features/executions/server/run-node";
import { resolveExpression } from "@/features/executions/template";
import prisma from "@/lib/db";
import { configSchema } from "./definition";

export async function execute(
  context: NodeExecutionContext,
): Promise<Record<string, unknown>> {
  const config = configSchema.parse(context.node.data);
  const organizationId = context.organizationId;

  if (!organizationId) {
    throw new Error(
      "Tenant context is required for Workspace Table operations.",
    );
  }

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
        payload[field.key] = resolveExpression(field.value, context.data);
      }
    }

    const record = await prisma.workspaceRecord.create({
      data: {
        tableId: table.id,
        organizationId,
        data: payload,
      },
    });

    return { ...context.data, [config.variableName]: record };
  }

  if (action === "update") {
    if (!config.recordId)
      throw new Error("recordId is required for update action");
    const recordId = resolveExpression(config.recordId, context.data);

    // Check ownership
    const existing = await prisma.workspaceRecord.findUnique({
      where: { id: String(recordId), organizationId, tableId: table.id },
    });
    if (!existing) throw new Error("Record not found or access denied.");

    const payload: Record<string, unknown> =
      (existing.data as Record<string, unknown>) || {};
    if (config.data) {
      for (const field of config.data) {
        payload[field.key] = resolveExpression(field.value, context.data);
      }
    }

    const record = await prisma.workspaceRecord.update({
      where: { id: String(recordId) },
      data: { data: payload },
    });

    return { ...context.data, [config.variableName]: record };
  }

  if (action === "find") {
    if (!config.recordId)
      throw new Error("recordId is required for find action");
    const recordId = resolveExpression(config.recordId, context.data);

    const record = await prisma.workspaceRecord.findUnique({
      where: { id: String(recordId), organizationId, tableId: table.id },
    });
    if (!record) throw new Error("Record not found.");

    return { ...context.data, [config.variableName]: record };
  }

  if (action === "find_many") {
    const records = await prisma.workspaceRecord.findMany({
      where: { organizationId, tableId: table.id },
      take: 100, // Hard limit for safety in v1
      orderBy: { createdAt: "desc" },
    });

    return { ...context.data, [config.variableName]: records };
  }

  if (action === "delete") {
    if (!config.recordId)
      throw new Error("recordId is required for delete action");
    const recordId = resolveExpression(config.recordId, context.data);

    // Check ownership
    const existing = await prisma.workspaceRecord.findUnique({
      where: { id: String(recordId), organizationId, tableId: table.id },
    });
    if (!existing) throw new Error("Record not found or access denied.");

    await prisma.workspaceRecord.delete({
      where: { id: String(recordId) },
    });

    return {
      ...context.data,
      [config.variableName]: { success: true, id: recordId },
    };
  }

  throw new Error(`Unsupported action: ${action}`);
}
