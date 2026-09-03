import { createId } from "@paralleldrive/cuid2";
import { TRPCError } from "@trpc/server";
import type { Edge } from "@xyflow/react";
import { generateSlug } from "random-word-slugs";
import z from "zod";
import { PAGINATION } from "@/config/constants";
import { validate } from "@/engine/validate";
import { saveWorkflowInputSchema } from "@/features/workflows/schemas";
import type { Prisma } from "@/generated/prisma/client";
import { sendWorkflowExecution } from "@/inngest/utils";
import prisma from "@/lib/db";
import { resolveEdgePorts } from "@/nodes/ports";
import { nodeRegistry } from "@/nodes/registry";
import {
  createTRPCRouter,
  orgEditorProcedure,
  orgViewerProcedure,
  premiumOrgProcedure,
} from "@/trpc/init";
import {
  buildNodeTestRunPlan,
  buildTestGraph,
  buildTestRunPlan,
  type TestRunPlan,
} from "./test-run";

export const workflowsRouter = createTRPCRouter({
  /** @deprecated Use `run` instead. Kept for backward compatibility. */
  execute: orgEditorProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const workflow = await prisma.workflow.findUniqueOrThrow({
        where: {
          id: input.id,
          organizationId: ctx.org.id,
        },
      });

      await sendWorkflowExecution({
        workflowId: input.id,
      });

      return workflow;
    }),
  /**
   * Run a workflow: create an Execution record (AF-M2-06) then emit
   * the inngest event. Returns the new execution so the client can
   * navigate to the detail page immediately.
   */
  run: orgEditorProcedure
    .input(
      z.object({
        id: z.string(),
        initialData: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const workflow = await prisma.workflow.findUniqueOrThrow({
        where: {
          id: input.id,
          organizationId: ctx.org.id,
        },
        select: { id: true, name: true, organizationId: true },
      });

      const placeholderEventId = createId();
      const execution = await prisma.execution.create({
        data: {
          workflowId: workflow.id,
          trigger: "MANUAL",
          mode: "PRODUCTION",
          status: "RUNNING",
          inngestEventId: placeholderEventId,
          organizationId: workflow.organizationId,
        },
      });

      const { eventId } = await sendWorkflowExecution({
        workflowId: workflow.id,
        userId: ctx.auth.user.id,
        executionId: execution.id,
        initialData: input.initialData,
        organizationId: workflow.organizationId,
      });

      await prisma.execution.update({
        where: { id: execution.id },
        data: { inngestEventId: eventId },
      });

      return execution;
    }),
  /**
   * In-editor test run (AF-M2-08). Runs the CURRENT DRAFT (unsaved canvas),
   * recorded as a `mode: TEST` execution that is filtered out of the main
   * executions list by default. With `testNodeId` only that single node
   * executes; without it the whole draft runs.
   */
  testRun: orgEditorProcedure
    .input(
      z.object({
        id: z.string().min(1).max(64),
        nodes: z
          .array(
            z.object({
              id: z.string().min(1).max(64),
              type: z.string().min(1).max(128),
              data: z.record(z.string(), z.unknown()).optional(),
            }),
          )
          .min(1),
        edges: z.array(
          z.object({
            source: z.string().min(1).max(64),
            target: z.string().min(1).max(64),
            sourceHandle: z.string().max(128).nullish(),
            targetHandle: z.string().max(128).nullish(),
          }),
        ),
        testNodeId: z.string().min(1).max(64).optional(),
        initialData: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const workflow = await prisma.workflow.findUniqueOrThrow({
        where: {
          id: input.id,
          organizationId: ctx.org.id,
        },
        select: { id: true, name: true, organizationId: true },
      });

      const graph = buildTestGraph(input.nodes, input.edges);
      let plan: TestRunPlan;
      try {
        plan = input.testNodeId
          ? buildNodeTestRunPlan(graph, input.testNodeId)
          : buildTestRunPlan(graph);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new TRPCError({ code: "BAD_REQUEST", message });
      }

      const placeholderEventId = createId();
      const execution = await prisma.execution.create({
        data: {
          workflowId: workflow.id,
          trigger: "MANUAL",
          mode: "TEST",
          status: "RUNNING",
          inngestEventId: placeholderEventId,
          organizationId: workflow.organizationId,
          graphSnapshot: plan.graphSnapshot as unknown as Prisma.InputJsonValue,
        },
      });

      const { eventId } = await sendWorkflowExecution({
        workflowId: workflow.id,
        userId: ctx.auth.user.id,
        executionId: execution.id,
        graphSnapshot: plan.graphSnapshot,
        skipNodes: plan.skipNodes,
        skipReason: plan.skipReason,
        endAfterNodeId: plan.endAfterNodeId,
        initialData: input.initialData,
        organizationId: workflow.organizationId,
      });

      await prisma.execution.update({
        where: { id: execution.id },
        data: { inngestEventId: eventId },
      });

      return execution;
    }),
  create: premiumOrgProcedure.mutation(({ ctx }) => {
    return prisma.workflow.create({
      data: {
        name: generateSlug(3),
        userId: ctx.auth.user.id,
        organizationId: ctx.org.id,
        nodes: {
          create: {
            type: "MANUAL_TRIGGER",
            position: { x: 0, y: 0 },
            name: "MANUAL_TRIGGER",
          },
        },
      },
    });
  }),
  remove: orgEditorProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ ctx, input }) => {
      return prisma.workflow.delete({
        where: {
          id: input.id,
          organizationId: ctx.org.id,
        },
      });
    }),
  saveGraph: orgEditorProcedure
    .input(saveWorkflowInputSchema)
    .mutation(async ({ ctx, input }) => {
      const { id, nodes, edges, revision } = input;

      // AF-M9-03: one port resolution for validation AND persistence, so the
      // graph the validator approves is byte-for-byte the graph that is stored
      // and later executed. Also translates the pre-AF-M9-03 `source-1`/
      // `target-1` handles a stale browser tab can still post.
      const typeOfNode = (nodeId: string) =>
        nodes.find((n) => n.id === nodeId)?.type;
      const edgePorts = new Map(
        edges.map((e) => [e, resolveEdgePorts(e, typeOfNode)] as const),
      );

      const workflow = await prisma.workflow.findUniqueOrThrow({
        where: { id, organizationId: ctx.org.id },
      });

      if (workflow.revision !== revision) {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "Workflow has been modified since you last loaded it. Please reload and try again.",
        });
      }

      // Graph-level validation (AF-M2-02): cycles, unknown types,
      // invalid configs, missing trigger, unconnected required inputs.
      const { errors } = validate(
        {
          nodes: nodes.map((n) => ({
            id: n.id,
            name: n.name ?? n.type,
            type: n.type,
            data: n.data as Record<string, unknown>,
          })),
          connections: edges.map((e) => ({
            fromNodeId: e.source,
            toNodeId: e.target,
            ...(edgePorts.get(e) as { fromOutput: string; toInput: string }),
          })),
        },
        nodeRegistry,
      );

      const criticalErrors = errors.filter((e) => e.severity === "error");
      if (criticalErrors.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Graph validation failed: ${criticalErrors.map((e) => e.message).join("; ")}`,
        });
      }

      return await prisma.$transaction(async (tx) => {
        await tx.node.deleteMany({ where: { workflowId: id } });
        await tx.connection.deleteMany({ where: { workflowId: id } });

        if (nodes.length > 0) {
          await tx.node.createMany({
            data: nodes.map((node) => ({
              id: node.id,
              workflowId: id,
              name: node.name ?? node.type,
              type: node.type,
              position: node.position,
              data: node.data || {},
              notes: node.notes ?? null,
              disabled: node.disabled ?? false,
            })),
          });
        }

        if (edges.length > 0) {
          const nodeIds = new Set(nodes.map((n) => n.id));
          const validEdges = edges.filter(
            (e) => nodeIds.has(e.source) && nodeIds.has(e.target),
          );

          if (validEdges.length > 0) {
            await tx.connection.createMany({
              data: validEdges.map((edge) => ({
                workflowId: id,
                fromNodeId: edge.source,
                toNodeId: edge.target,
                ...(edgePorts.get(edge) as {
                  fromOutput: string;
                  toInput: string;
                }),
              })),
            });
          }
        }

        const updated = await tx.workflow.update({
          where: { id },
          data: { revision: { increment: 1 }, updatedAt: new Date() },
          select: {
            id: true,
            name: true,
            revision: true,
            nodes: {
              select: {
                id: true,
                type: true,
                position: true,
                data: true,
                name: true,
                notes: true,
                disabled: true,
              },
            },
            connections: {
              select: {
                id: true,
                fromNodeId: true,
                toNodeId: true,
                fromOutput: true,
                toInput: true,
              },
            },
          },
        });

        return {
          id: updated.id,
          name: updated.name,
          revision: updated.revision,
          nodes: updated.nodes.map((n) => ({
            id: n.id,
            type: n.type,
            position: n.position as { x: number; y: number },
            data: (n.data as Record<string, unknown>) || {},
            name: n.name ?? n.type,
            notes: n.notes ?? undefined,
            disabled: n.disabled ?? false,
          })),
          edges: updated.connections.map((c) => ({
            id: c.id,
            source: c.fromNodeId,
            target: c.toNodeId,
            sourceHandle: c.fromOutput,
            targetHandle: c.toInput,
          })),
        };
      });
    }),
  updateName: orgEditorProcedure
    .input(z.object({ id: z.string(), name: z.string().min(1) }))
    .mutation(({ ctx, input }) => {
      return prisma.workflow.update({
        where: { id: input.id, organizationId: ctx.org.id },
        data: { name: input.name },
      });
    }),
  /**
   * AF-M7-08: per-workflow notification delivery. Editor rung, not viewer —
   * this changes what the whole workspace gets told about.
   */
  updateNotificationPrefs: orgEditorProcedure
    .input(
      z.object({
        id: z.string(),
        notifyOnFailure: z.boolean().optional(),
        notifyOnSuccess: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...prefs } = input;
      const updated = await prisma.workflow.update({
        where: { id, organizationId: ctx.org.id },
        data: prefs,
        select: { id: true, notifyOnFailure: true, notifyOnSuccess: true },
      });
      return updated;
    }),
  getOne: orgViewerProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const workflow = await prisma.workflow.findUniqueOrThrow({
        where: { id: input.id, organizationId: ctx.org.id },
        select: {
          id: true,
          name: true,
          webhookSecret: true,
          revision: true,
          notifyOnFailure: true,
          notifyOnSuccess: true,
          nodes: {
            select: {
              id: true,
              type: true,
              position: true,
              data: true,
              name: true,
              notes: true,
              disabled: true,
            },
          },
          connections: {
            select: {
              id: true,
              fromNodeId: true,
              toNodeId: true,
              fromOutput: true,
              toInput: true,
            },
          },
        },
      });

      // Transform server nodes to react-flow compatible nodes
      const nodes = workflow.nodes.map((node) => ({
        id: node.id,
        type: node.type,
        position: node.position as { x: number; y: number },
        data: (node.data as Record<string, unknown>) || {},
        name: node.name ?? node.type,
        notes: node.notes ?? undefined,
        disabled: node.disabled ?? false,
      }));

      // Transform server connections to react-flow compatible edges
      const edges: Edge[] = workflow.connections.map((connection) => ({
        id: connection.id,
        source: connection.fromNodeId,
        target: connection.toNodeId,
        sourceHandle: connection.fromOutput,
        targetHandle: connection.toInput,
      }));

      return {
        id: workflow.id,
        name: workflow.name,
        webhookSecret: workflow.webhookSecret,
        revision: workflow.revision,
        notifyOnFailure: workflow.notifyOnFailure,
        notifyOnSuccess: workflow.notifyOnSuccess,
        nodes,
        edges,
      };
    }),
  getMany: orgViewerProcedure
    .input(
      z.object({
        page: z.number().default(PAGINATION.DEFAULT_PAGE),
        pageSize: z
          .number()
          .min(PAGINATION.MIN_PAGE_SIZE)
          .max(PAGINATION.MAX_PAGE_SIZE)
          .default(PAGINATION.DEFAULT_PAGE_SIZE),
        search: z.string().default(""),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { page, pageSize, search } = input;

      const [items, totalCount] = await Promise.all([
        prisma.workflow.findMany({
          skip: (page - 1) * pageSize,
          take: pageSize,
          where: {
            organizationId: ctx.org.id,
            name: {
              contains: search,
              mode: "insensitive",
            },
          },
          select: {
            id: true,
            name: true,
            createdAt: true,
            updatedAt: true,
            revision: true,
          },
          orderBy: {
            updatedAt: "desc",
          },
        }),
        prisma.workflow.count({
          where: {
            organizationId: ctx.org.id,
            name: {
              contains: search,
              mode: "insensitive",
            },
          },
        }),
      ]);

      const totalPages = Math.ceil(totalCount / pageSize);
      const hasNextPage = page < totalPages;
      const hasPreviousPage = page > 1;

      return {
        items,
        page,
        pageSize,
        totalCount,
        totalPages,
        hasNextPage,
        hasPreviousPage,
      };
    }),

  publish: orgEditorProcedure
    .input(z.object({ id: z.string(), activate: z.boolean().default(true) }))
    .mutation(async ({ ctx, input }) => {
      const { id, activate } = input;
      const workflow = await prisma.workflow.findUniqueOrThrow({
        where: { id, organizationId: ctx.org.id },
        select: {
          id: true,
          revision: true,
          nodes: {
            select: {
              id: true,
              type: true,
              position: true,
              data: true,
              name: true,
              notes: true,
              disabled: true,
            },
          },
          connections: {
            select: {
              id: true,
              fromNodeId: true,
              toNodeId: true,
              fromOutput: true,
              toInput: true,
            },
          },
        },
      });

      // Find max version number
      const maxVersion = await prisma.workflowVersion.findFirst({
        where: { workflowId: id },
        orderBy: { version: "desc" },
        select: { version: true },
      });
      const nextVersionNumber = (maxVersion?.version || 0) + 1;

      // Graph snapshot includes nodes and edges
      const graphSnapshot = {
        nodes: workflow.nodes.map((n) => ({
          id: n.id,
          type: n.type,
          position: n.position,
          data: n.data,
          name: n.name ?? n.type,
          notes: n.notes ?? undefined,
          disabled: n.disabled ?? false,
        })),
        edges: workflow.connections.map((c) => ({
          id: c.id,
          source: c.fromNodeId,
          target: c.toNodeId,
          sourceHandle: c.fromOutput,
          targetHandle: c.toInput,
        })),
      };

      return await prisma.$transaction(async (tx) => {
        const newVersion = await tx.workflowVersion.create({
          data: {
            workflowId: id,
            version: nextVersionNumber,
            workflowRevision: workflow.revision,
            graphSnapshot: graphSnapshot as Prisma.InputJsonValue,
          },
        });

        if (activate) {
          await tx.workflow.update({
            where: { id },
            data: { activeVersionId: newVersion.id },
          });
        }

        return newVersion;
      });
    }),

  activate: orgEditorProcedure
    .input(z.object({ workflowId: z.string(), versionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Ensure the version exists and belongs to the current org's workflow
      const version = await prisma.workflowVersion.findFirstOrThrow({
        where: {
          id: input.versionId,
          workflowId: input.workflowId,
          workflow: { organizationId: ctx.org.id },
        },
      });

      await prisma.workflow.update({
        where: { id: input.workflowId },
        data: { activeVersionId: version.id },
      });

      return { success: true, activeVersionId: version.id };
    }),

  deactivate: orgEditorProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Ensure the workflow belongs to the current org
      await prisma.workflow.findUniqueOrThrow({
        where: { id: input.id, organizationId: ctx.org.id },
      });

      await prisma.workflow.update({
        where: { id: input.id },
        data: { activeVersionId: null },
      });

      return { success: true, activeVersionId: null };
    }),

  getVersions: orgViewerProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const workflow = await prisma.workflow.findUniqueOrThrow({
        where: { id: input.id, organizationId: ctx.org.id },
        select: {
          id: true,
          activeVersionId: true,
          versions: {
            orderBy: { version: "desc" },
            select: {
              id: true,
              version: true,
              workflowRevision: true,
              createdAt: true,
              graphSnapshot: true,
            },
          },
        },
      });

      return {
        activeVersionId: workflow.activeVersionId,
        versions: workflow.versions,
      };
    }),
});
