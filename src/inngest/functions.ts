import { NonRetriableError } from "inngest";
import { validate } from "@/engine/validate";
import {
  ExecutionStatus,
  NodeExecutionStatus,
} from "@/generated/prisma/client";
import prisma from "@/lib/db";
import { getNodeRegistration, nodeRegistry } from "@/nodes/registry";
import { anthropicChannel } from "./channels/anthropic";
import { discordChannel } from "./channels/discord";
import { geminiChannel } from "./channels/gemini";
import { googleFormTriggerChannel } from "./channels/google-form-trigger";
import { httpRequestChannel } from "./channels/http-request";
import { manualTriggerChannel } from "./channels/manual-trigger";
import { openAiChannel } from "./channels/openai";
import { slackChannel } from "./channels/slack";
import { stripeTriggerChannel } from "./channels/stripe-trigger";
import { inngest } from "./client";
import { ENGINE_RETRIES, truncateStack } from "./config";
import { buildSkippedTraces, computeDurationMs, type TraceNode } from "./trace";

export const executeWorkflow = inngest.createFunction(
  {
    id: "execute-workflow",
    retries: ENGINE_RETRIES,
    onFailure: async ({ event }) => {
      const failedExecution = await prisma.execution.findUnique({
        where: { inngestEventId: event.data.event.id },
        select: { startedAt: true },
      });
      const durationMs = failedExecution
        ? computeDurationMs(failedExecution.startedAt.getTime(), Date.now())
        : null;
      return prisma.execution.update({
        where: { inngestEventId: event.data.event.id },
        data: {
          status: ExecutionStatus.FAILED,
          completedAt: new Date(),
          durationMs,
          error: event.data.error.message,
          errorStack: truncateStack(event.data.error.stack),
        },
      });
    },
  },
  {
    event: "workflows/execute.workflow",
    channels: [
      httpRequestChannel(),
      manualTriggerChannel(),
      googleFormTriggerChannel(),
      stripeTriggerChannel(),
      geminiChannel(),
      openAiChannel(),
      anthropicChannel(),
      discordChannel(),
      slackChannel(),
    ],
  },
  async ({ event, step, publish, attempt }) => {
    const inngestEventId = event.id;
    const workflowId = event.data.workflowId;

    if (!inngestEventId || !workflowId) {
      throw new NonRetriableError("Event ID or workflow ID is missing");
    }

    const execution = await step.run("create-execution", async () => {
      const workflow = await prisma.workflow.findUniqueOrThrow({
        where: { id: workflowId },
        include: { nodes: true, connections: true },
      });
      return prisma.execution.create({
        data: {
          workflowId,
          inngestEventId,
          trigger: (event.data.trigger as string) || "MANUAL",
          mode: (event.data.mode as string) || "PRODUCTION",
          graphSnapshot: {
            nodes: workflow.nodes,
            connections: workflow.connections,
          },
        },
      });
    });

    const sortedNodes: TraceNode[] = await step.run(
      "prepare-workflow",
      async () => {
        const workflow = await prisma.workflow.findUniqueOrThrow({
          where: { id: workflowId },
          include: {
            nodes: true,
            connections: true,
          },
        });

        const { errors, order } = validate(
          {
            nodes: workflow.nodes.map((n) => ({
              id: n.id,
              name: n.name,
              type: n.type,
              data: (n.data ?? {}) as Record<string, unknown>,
            })),
            connections: workflow.connections.map((c) => ({
              fromNodeId: c.fromNodeId,
              toNodeId: c.toNodeId,
              fromOutput: c.fromOutput,
              toInput: c.toInput,
            })),
          },
          // Registry is imported dynamically on the server to avoid
          // pulling it into the client bundle.
          nodeRegistry,
        );

        const criticalErrors = errors.filter((e) => e.severity === "error");
        if (criticalErrors.length > 0) {
          throw new NonRetriableError(
            `Graph validation failed: ${criticalErrors.map((e) => e.message).join("; ")}`,
          );
        }

        const nodeMap = new Map(workflow.nodes.map((n) => [n.id, n]));
        return order
          .map((id) => nodeMap.get(id))
          .filter((n): n is NonNullable<typeof n> => Boolean(n));
      },
    );

    const userId = await step.run("find-user-id", async () => {
      const workflow = await prisma.workflow.findUniqueOrThrow({
        where: { id: workflowId },
        select: {
          userId: true,
        },
      });

      return workflow.userId;
    });

    // Initialize context with any initial data from the trigger
    let context = event.data.initialData || {};

    // Execute each node with a per-node trace (AF-A-05). Trace writes are
    // their own steps so they are replay-safe and never re-fire.
    for (const [index, node] of sortedNodes.entries()) {
      const { execute } = getNodeRegistration(node.type);
      let startedAtMs = Date.now();

      try {
        startedAtMs = await step.run(`trace-start:${node.id}`, async () => {
          // A previous attempt may have left a FAILED row here (Inngest
          // retries the whole function); replace it so this attempt
          // starts from a clean RUNNING state.
          await prisma.nodeExecution.deleteMany({
            where: { executionId: execution.id, nodeId: node.id },
          });
          const row = await prisma.nodeExecution.create({
            data: {
              executionId: execution.id,
              nodeId: node.id,
              nodeName: node.name,
              nodeType: node.type,
              status: NodeExecutionStatus.RUNNING,
              attempt,
              order: index,
            },
          });
          return row.startedAt.getTime();
        });

        context = await execute({
          data: node.data as Record<string, unknown>,
          nodeId: node.id,
          userId,
          context,
          step,
          publish,
        });

        await step.run(`trace-end:${node.id}`, async () => {
          const finishedAtMs = Date.now();
          return prisma.nodeExecution.updateMany({
            where: {
              executionId: execution.id,
              nodeId: node.id,
            },
            data: {
              status: NodeExecutionStatus.SUCCESS,
              finishedAt: new Date(finishedAtMs),
              durationMs: computeDurationMs(startedAtMs, finishedAtMs),
            },
          });
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        await step.run(`trace-fail:${node.id}`, async () => {
          const finishedAtMs = Date.now();
          return prisma.nodeExecution.updateMany({
            where: {
              executionId: execution.id,
              nodeId: node.id,
            },
            data: {
              status: NodeExecutionStatus.FAILED,
              error: message,
              finishedAt: new Date(finishedAtMs),
              durationMs: computeDurationMs(startedAtMs, finishedAtMs),
            },
          });
        });

        // Everything after the failed node never ran - record it as
        // SKIPPED so the trace shows the full plan, not just what executed.
        await step.run("trace-skip-remaining", async () => {
          const rows = buildSkippedTraces(
            sortedNodes,
            index + 1,
            execution.id,
            "Skipped: an upstream node failed",
          );
          if (rows.length > 0) {
            // The executor registry has already validated every node type;
            // trace rows carry plain string type ids.
            await prisma.nodeExecution.createMany({
              data: rows,
            });
          }
          return rows.length;
        });

        throw error;
      }
    }

    await step.run("update-execution", async () => {
      const finishedAt = new Date();
      const durationMs = computeDurationMs(
        new Date(execution.startedAt).getTime(),
        finishedAt.getTime(),
      );
      const nodeCount = await prisma.nodeExecution.count({
        where: { executionId: execution.id },
      });
      return prisma.execution.update({
        where: { inngestEventId, workflowId },
        data: {
          status: ExecutionStatus.SUCCESS,
          completedAt: finishedAt,
          durationMs,
          nodeCount,
          output: context,
        },
      });
    });

    return {
      workflowId,
      result: context,
    };
  },
);
