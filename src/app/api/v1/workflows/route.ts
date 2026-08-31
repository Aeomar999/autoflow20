import type { NextRequest } from "next/server";
import {
  decodeCursor,
  encodeCursor,
  parseLimit,
} from "@/features/api-keys/lib/cursor";
import { handlePublicApi } from "@/features/api-keys/server/public-api";
import { serializeWorkflow } from "@/features/api-keys/server/serialize";
import prisma from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/workflows — list workflows (scope: workflows:read).
 * Cursor-paginated (`?limit=&cursor=`), ordered `createdAt desc, id desc`,
 * tenant-scoped to the API key's org in the `where` clause.
 */
export async function GET(req: NextRequest) {
  return handlePublicApi(req, "workflows:read", async (principal) => {
    const url = new URL(req.url);
    const limit = parseLimit(url.searchParams.get("limit"));
    const cursor = decodeCursor(url.searchParams.get("cursor"));

    const where = {
      organizationId: principal.organizationId,
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: new Date(cursor.sortValue) } },
              {
                createdAt: new Date(cursor.sortValue),
                id: { lt: cursor.id },
              },
            ],
          }
        : {}),
    };

    const rows = await prisma.workflow.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      select: { id: true, name: true, createdAt: true, updatedAt: true },
    });

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor(last.createdAt.toISOString(), last.id)
        : null;

    return {
      data: page.map(serializeWorkflow),
      next_cursor: nextCursor,
    };
  });
}
