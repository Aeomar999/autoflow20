import type { NextRequest } from "next/server";
import {
  handlePublicApi,
  PublicApiError,
} from "@/features/api-keys/server/public-api";
import { serializeExecution } from "@/features/api-keys/server/serialize";
import prisma from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/executions/:id — single execution (scope: executions:read).
 * Cross-tenant is NOT_FOUND. Large IO columns (graphSnapshot, input, output,
 * errorStack) are intentionally not exposed on the public surface.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return handlePublicApi(req, "executions:read", async (principal) => {
    const { id } = await params;
    const execution = await prisma.execution.findFirst({
      where: {
        id,
        workflow: { organizationId: principal.organizationId },
      },
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
    if (!execution) {
      throw new PublicApiError(404, "NOT_FOUND", "Execution not found");
    }
    return serializeExecution(execution);
  });
}
