import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { PAGINATION } from "@/config/constants";
import { inngest } from "@/inngest/client";
import { logAuditEvent } from "@/lib/audit";
import prisma from "@/lib/db";
import {
  createTRPCRouter,
  orgEditorProcedure,
  orgViewerProcedure,
} from "@/trpc/init";

const approvalStatusSchema = z.enum([
  "PENDING",
  "APPROVED",
  "REJECTED",
  "TIMED_OUT",
]);

export const approvalsRouter = createTRPCRouter({
  list: orgViewerProcedure
    .input(
      z.object({
        status: approvalStatusSchema.optional(),
        page: z.number().default(PAGINATION.DEFAULT_PAGE),
        pageSize: z
          .number()
          .min(PAGINATION.MIN_PAGE_SIZE)
          .max(PAGINATION.MAX_PAGE_SIZE)
          .default(PAGINATION.DEFAULT_PAGE_SIZE),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { status, page, pageSize } = input;

      const where = {
        organizationId: ctx.org.id,
        ...(status ? { status } : {}),
      };

      const [items, totalCount] = await Promise.all([
        prisma.approvalRequest.findMany({
          skip: (page - 1) * pageSize,
          take: pageSize,
          where,
          orderBy: { createdAt: "desc" },
          include: {
            workflow: {
              select: { id: true, name: true },
            },
            respondedBy: {
              select: { id: true, name: true, email: true },
            },
          },
        }),
        prisma.approvalRequest.count({ where }),
      ]);

      const totalPages = Math.ceil(totalCount / pageSize);

      return {
        items,
        page,
        pageSize,
        totalCount,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      };
    }),

  respond: orgEditorProcedure
    .input(
      z.object({
        id: z.string(),
        decision: z.enum(["APPROVED", "REJECTED"]),
        comment: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const request = await prisma.approvalRequest.findFirstOrThrow({
        where: {
          id: input.id,
          organizationId: ctx.org.id,
        },
      });

      if (request.status !== "PENDING") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Approval request is already resolved with status: ${request.status}`,
        });
      }

      if (request.timeoutAt < new Date()) {
        await prisma.approvalRequest.update({
          where: { id: request.id },
          data: { status: "TIMED_OUT" },
        });

        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Approval request has timed out",
        });
      }

      const updated = await prisma.approvalRequest.update({
        where: { id: request.id },
        data: {
          status: input.decision,
          comment: input.comment,
          respondedById: ctx.auth.user.id,
          respondedAt: new Date(),
        },
      });

      try {
        await inngest.send({
          name: "workflow.approval.responded",
          data: {
            approvalId: updated.id,
            executionId: updated.executionId,
            status: input.decision,
            comment: input.comment,
            userId: ctx.auth.user.id,
          },
        });
      } catch (err) {
        console.error(
          "[approvals] Failed to send Inngest resumption event:",
          err,
        );
      }

      await logAuditEvent({
        organizationId: ctx.org.id,
        actorId: ctx.auth.user.id,
        action: `approval.${input.decision.toLowerCase()}`,
        resourceType: "approval_request",
        resourceId: updated.id,
        after: { status: input.decision, comment: input.comment },
      });

      return updated;
    }),
});
