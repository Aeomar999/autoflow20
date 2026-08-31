import type { NextRequest } from "next/server";
import {
  decodeCursor,
  encodeCursor,
  parseLimit,
} from "@/features/api-keys/lib/cursor";
import { handlePublicApi } from "@/features/api-keys/server/public-api";
import { serializeExecution } from "@/features/api-keys/server/serialize";
import prisma from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/executions — list executions (scope: executions:read).
 * Cursor-paginated, ordered `startedAt desc, id desc`, tenant-scoped to the
 * API key's org. Large IO columns (graphSnapshot, input, output, errorStack)
 * are deliberately not selected, matching the internal list contract.
 */
export async function GET(req: NextRequest) {
  return handlePublicApi(req, "executions:read", async (principal) => {
    const url = new URL(req.url);
    const limit = parseLimit(url.searchParams.get("limit"));
    const cursor = decodeCursor(url.searchParams.get("cursor"));

    const where = {
      workflow: { organizationId: principal.organizationId },
      ...(cursor
        ? {
            OR: [
              { startedAt: { lt: new Date(cursor.sortValue) } },
              {
                startedAt: new Date(cursor.sortValue),
                id: { lt: cursor.id },
              },
            ],
          }
        : {}),
    };

    const rows = await prisma.execution.findMany({
      where,
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
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

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor(last.startedAt.toISOString(), last.id)
        : null;

    return {
      data: page.map((row) => serializeExecution(row)),
      next_cursor: nextCursor,
    };
  });
}
