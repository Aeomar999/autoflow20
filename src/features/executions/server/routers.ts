import { createId } from "@paralleldrive/cuid2";
import { TRPCError } from "@trpc/server";
import z from "zod";
import { PAGINATION } from "@/config/constants";
import { sendWorkflowExecution } from "@/inngest/utils";
import prisma from "@/lib/db";
import { createTRPCRouter, protectedProcedure } from "@/trpc/init";
import { computeSkipNodes } from "./executions-router-helpers";

const executionStatusSchema = z.enum([
  "RUNNING",
  "SUCCESS",
  "FAILED",
  "CANCELLED",
  "TIMED_OUT",
]);

export const executionsRouter = createTRPCRouter({
  /**
   * List executions with filters. Does NOT select large IO columns
   * (input, output, graphSnapshot, errorStack) to keep payload small.
   */
  list: protectedProcedure
    .input(
      z.object({
        workflowId: z.string().optional(),
        status: executionStatusSchema.optional(),
        startedAfter: z.date().optional(),
        startedBefore: z.date().optional(),
        mode: z.enum(["PRODUCTION", "TEST"]).optional(),
        page: z.number().default(PAGINATION.DEFAULT_PAGE),
        pageSize: z
          .number()
          .min(PAGINATION.MIN_PAGE_SIZE)
          .max(PAGINATION.MAX_PAGE_SIZE)
          .default(PAGINATION.DEFAULT_PAGE_SIZE),
      }),
    )
    .query(async ({ ctx, input }) => {
      const {
        workflowId,
        status,
        startedAfter,
        startedBefore,
        mode,
        page,
        pageSize,
      } = input;

      const where = {
        workflow: {
          userId: ctx.auth.user.id,
          ...(workflowId ? { id: workflowId } : {}),
        },
        // Test runs (AF-M2-08) are filtered out unless explicitly queried.
        mode: mode ?? { not: "TEST" },
        ...(status ? { status } : {}),
        ...(startedAfter || startedBefore
          ? {
              startedAt: {
                ...(startedAfter ? { gte: startedAfter } : {}),
                ...(startedBefore ? { lte: startedBefore } : {}),
              },
            }
          : {}),
      };

      const [items, totalCount] = await Promise.all([
        prisma.execution.findMany({
          skip: (page - 1) * pageSize,
          take: pageSize,
          where,
          orderBy: { startedAt: "desc" },
          select: {
            id: true,
            status: true,
            trigger: true,
            mode: true,
            startedAt: true,
            completedAt: true,
            durationMs: true,
            nodeCount: true,
            tokensIn: true,
            tokensOut: true,
            costUsd: true,
            workflowId: true,
            inngestEventId: true,
            workflow: {
              select: { id: true, name: true },
            },
          },
        }),
        prisma.execution.count({ where }),
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

  /**
   * Get a single execution by ID, scoped to the current user.
   * Returns the full run plus ordered node traces.
   */
  getOne: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(({ ctx, input }) => {
      return prisma.execution.findUniqueOrThrow({
        where: {
          id: input.id,
          workflow: { userId: ctx.auth.user.id },
        },
        select: {
          id: true,
          status: true,
          trigger: true,
          mode: true,
          graphSnapshot: true,
          input: true,
          error: true,
          errorStack: true,
          startedAt: true,
          completedAt: true,
          durationMs: true,
          nodeCount: true,
          tokensIn: true,
          tokensOut: true,
          costUsd: true,
          output: true,
          workflowId: true,
          inngestEventId: true,
          workflow: {
            select: { id: true, name: true },
          },
          nodeExecutions: {
            orderBy: { order: "asc" },
          },
        },
      });
    }),

  /**
   * Cancel a running execution. Only RUNNING executions can be cancelled.
   * Cross-tenant access returns NOT_FOUND.
   */
  cancel: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const execution = await prisma.execution.findUnique({
        where: {
          id: input.id,
          workflow: { userId: ctx.auth.user.id },
        },
        select: { id: true, status: true },
      });

      if (!execution) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Execution not found",
        });
      }

      if (execution.status !== "RUNNING") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot cancel execution in "${execution.status}" status`,
        });
      }

      return prisma.execution.update({
        where: { id: input.id },
        data: { status: "CANCELLED", completedAt: new Date() },
      });
    }),

  /**
   * Retry a failed/timed-out execution. Creates a new execution record
   * for the same workflow and re-emits the inngest event.
   */
  retry: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const execution = await prisma.execution.findUnique({
        where: {
          id: input.id,
          workflow: { userId: ctx.auth.user.id },
        },
        select: {
          id: true,
          status: true,
          workflowId: true,
          mode: true,
        },
      });

      if (!execution) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Execution not found",
        });
      }

      const retryableStatuses = ["FAILED", "TIMED_OUT", "CANCELLED"];
      if (!retryableStatuses.includes(execution.status)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot retry execution in "${execution.status}" status`,
        });
      }

      const placeholderEventId = createId();
      const newExecution = await prisma.execution.create({
        data: {
          workflowId: execution.workflowId,
          trigger: "MANUAL",
          mode: execution.mode,
          status: "RUNNING",
          inngestEventId: placeholderEventId,
        },
      });

      const { eventId } = await sendWorkflowExecution({
        workflowId: execution.workflowId,
        executionId: newExecution.id,
      });

      await prisma.execution.update({
        where: { id: newExecution.id },
        data: { inngestEventId: eventId },
      });

      return newExecution;
    }),

  /**
   * Retry a failed execution starting from a specific node.
   * Creates a new execution record and emits the inngest event with
   * skipNodes so the engine skips nodes before the given node.
   */
  retryFromNode: protectedProcedure
    .input(z.object({ id: z.string(), nodeId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const execution = await prisma.execution.findUnique({
        where: {
          id: input.id,
          workflow: { userId: ctx.auth.user.id },
        },
        select: {
          id: true,
          status: true,
          workflowId: true,
          mode: true,
          graphSnapshot: true,
        },
      });

      if (!execution) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Execution not found",
        });
      }

      const retryableStatuses = ["FAILED", "TIMED_OUT", "CANCELLED"];
      if (!retryableStatuses.includes(execution.status)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot retry execution in "${execution.status}" status`,
        });
      }

      const snapshot = execution.graphSnapshot as {
        nodes?: Array<{ id: string }>;
        connections?: Array<{ fromNodeId: string; toNodeId: string }>;
      } | null;

      const skipNodes = computeSkipNodes(snapshot, input.nodeId);

      const placeholderEventId = createId();
      const newExecution = await prisma.execution.create({
        data: {
          workflowId: execution.workflowId,
          trigger: "MANUAL",
          mode: execution.mode,
          status: "RUNNING",
          inngestEventId: placeholderEventId,
        },
      });

      const { eventId } = await sendWorkflowExecution({
        workflowId: execution.workflowId,
        executionId: newExecution.id,
        skipNodes,
      });

      await prisma.execution.update({
        where: { id: newExecution.id },
        data: { inngestEventId: eventId },
      });

      return newExecution;
    }),
});
