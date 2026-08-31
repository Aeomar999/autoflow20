import type { NextRequest } from "next/server";
import {
  handlePublicApi,
  PublicApiError,
} from "@/features/api-keys/server/public-api";
import { serializeExecution } from "@/features/api-keys/server/serialize";
import prisma from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/executions/:id/cancel — cancel a running execution
 * (scope: executions:write). Idempotent-ish: only RUNNING runs are cancelled;
 * anything else is a 409-style conflict. Cross-tenant is NOT_FOUND.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return handlePublicApi(req, "executions:write", async (principal) => {
    const { id } = await params;

    const execution = await prisma.execution.findFirst({
      where: {
        id,
        workflow: { organizationId: principal.organizationId },
      },
      select: {
        id: true,
        status: true,
      },
    });
    if (!execution) {
      throw new PublicApiError(404, "NOT_FOUND", "Execution not found");
    }
    if (execution.status !== "RUNNING") {
      throw new PublicApiError(
        409,
        "CONFLICT",
        `Cannot cancel execution in "${execution.status}" status`,
      );
    }

    const updated = await prisma.execution.update({
      where: { id: execution.id },
      data: { status: "CANCELLED", completedAt: new Date() },
      select: {
        id: true,
        workflowId: true,
        status: true,
        trigger: true,
        mode: true,
        startedAt: true,
        completedAt: true,
        durationMs: true,
        tokensIn: true,
        tokensOut: true,
        costUsd: true,
        error: true,
      },
    });

    return serializeExecution(updated);
  });
}
