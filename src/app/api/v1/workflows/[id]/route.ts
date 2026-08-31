import type { NextRequest } from "next/server";
import {
  handlePublicApi,
  PublicApiError,
} from "@/features/api-keys/server/public-api";
import { serializeWorkflow } from "@/features/api-keys/server/serialize";
import prisma from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/workflows/:id — single workflow (scope: workflows:read).
 * Cross-tenant is NOT_FOUND (never discloses the resource exists).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return handlePublicApi(req, "workflows:read", async (principal) => {
    const { id } = await params;
    const workflow = await prisma.workflow.findFirst({
      where: { id, organizationId: principal.organizationId },
      select: { id: true, name: true, createdAt: true, updatedAt: true },
    });
    if (!workflow) {
      throw new PublicApiError(404, "NOT_FOUND", "Workflow not found");
    }
    return serializeWorkflow(workflow);
  });
}
