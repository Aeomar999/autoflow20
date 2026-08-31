import { z } from "zod";

import { PAGINATION } from "@/config/constants";
import prisma from "@/lib/db";
import { createTRPCRouter, orgViewerProcedure } from "@/trpc/init";

import type { NotificationRow } from "../lib/types";

/**
 * Notification centre router (AF-M7-08).
 *
 * Every query and every mutation is scoped through `ctx.org.id` in the `where`
 * clause. Marking one read is an `updateMany` rather than an `update`, so the
 * org scope is part of the same statement — an `update` by id would need a
 * read-then-check, and that is the shape cross-tenant writes hide in.
 *
 * Notifications are workspace-level, not per-user: anyone who can see the
 * workspace sees them, matching executions and approvals. Read state is
 * therefore shared, which is the honest consequence of that model and is
 * recorded in `docs/architecture/data_model.md`.
 */

const listInput = z.object({
  /** "unread" is the bell's own view; "all" is the /notifications page. */
  filter: z.enum(["all", "unread"]).default("all"),
  page: z.number().int().min(1).default(PAGINATION.DEFAULT_PAGE),
  pageSize: z
    .number()
    .int()
    .min(PAGINATION.MIN_PAGE_SIZE)
    .max(PAGINATION.MAX_PAGE_SIZE)
    .default(20),
});

const SELECT = {
  id: true,
  type: true,
  title: true,
  message: true,
  href: true,
  readAt: true,
  createdAt: true,
  workflowId: true,
  executionId: true,
} as const;

export const notificationsRouter = createTRPCRouter({
  list: orgViewerProcedure.input(listInput).query(async ({ ctx, input }) => {
    const where = {
      organizationId: ctx.org.id,
      ...(input.filter === "unread" ? { readAt: null } : {}),
    };

    const [items, totalCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        select: SELECT,
      }),
      prisma.notification.count({ where }),
    ]);

    const totalPages = Math.ceil(totalCount / input.pageSize);

    return {
      items: items as NotificationRow[],
      page: input.page,
      pageSize: input.pageSize,
      totalCount,
      totalPages,
      hasNextPage: input.page < totalPages,
      hasPreviousPage: input.page > 1,
    };
  }),

  /** Drives the bell badge. Separate from `list` so the bell costs one count. */
  unreadCount: orgViewerProcedure.query(async ({ ctx }) => {
    const count = await prisma.notification.count({
      where: { organizationId: ctx.org.id, readAt: null },
    });
    return { count };
  }),

  markRead: orgViewerProcedure
    .input(z.object({ id: z.string().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      // updateMany, not update: the org scope lives in the same statement as
      // the write. A cross-tenant id matches zero rows and changes nothing.
      const result = await prisma.notification.updateMany({
        where: {
          id: input.id,
          organizationId: ctx.org.id,
          readAt: null,
        },
        data: { readAt: new Date() },
      });
      return { updated: result.count };
    }),

  markAllRead: orgViewerProcedure.mutation(async ({ ctx }) => {
    const result = await prisma.notification.updateMany({
      where: { organizationId: ctx.org.id, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }),
});
