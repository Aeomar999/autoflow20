import { NonRetriableError } from "inngest";
import { getExecutor } from "@/features/executions/lib/executor-registry";
import {
  ExecutionStatus,
  NodeExecutionStatus,
  type NodeType,
} from "@/generated/prisma";
import prisma from "@/lib/db";
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
import { topologicalSort } from "./utils";

export const executeWorkflow = inngest.createFunction(
  {
    id: "execute-workflow",
    retries: ENGINE_RETRIES,
    onFailure: async ({ event }) => {
      return prisma.execution.update({
        where: { inngestEventId: event.data.event.id },
        data: {
          status: ExecutionStatus.FAILED,
          completedAt: new Date(),
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
      return prisma.execution.create({
        data: {
          workflowId,
          inngestEventId,
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

        return topologicalSort(workflow.nodes, workflow.connections);
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
      const executor = getExecutor(node.type as NodeType);
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
              nodeType: node.type as NodeType,
              status: NodeExecutionStatus.RUNNING,
              attempt,
              order: index,
            },
          });
          return row.startedAt.getTime();
        });

        context = await executor({
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
            // narrow the trace rows' plain strings to the Prisma enum.
            await prisma.nodeExecution.createMany({
              data: rows.map((row) => ({
                ...row,
                nodeType: row.nodeType as NodeType,
              })),
            });
          }
          return rows.length;
        });

        throw error;
      }
    }

    await step.run("update-execution", async () => {
      return prisma.execution.update({
        where: { inngestEventId, workflowId },
        data: {
          status: ExecutionStatus.SUCCESS,
          completedAt: new Date(),
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
