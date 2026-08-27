import { NonRetriableError } from "inngest";
import { validate } from "@/engine/validate";
import { buildTemplateContext } from "@/features/executions/template";
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
import {
  buildGraphMaps,
  computeDurationMs,
  computeSkippableNodes,
  type GraphEdge,
  type GraphNodeExecution,
  markTakenEdges,
  OUTPUT_PORT_KEY,
  type TraceNode,
} from "./trace";

/** Default per-node wall-clock timeout (60 s). */
const DEFAULT_NODE_TIMEOUT_MS = 60_000;
/** Default per-node retry backoff. */
const DEFAULT_BACKOFF_MS = 1_000;

/**
 * Build `GraphNodeExecution[]` from persisted node rows. Resolves
 * per-node config overrides and falls back to definition defaults.
 */
function buildExecutionPlan(sortedNodes: TraceNode[]): GraphNodeExecution[] {
  return sortedNodes.map((node) => {
    const def = getNodeRegistration(node.type);
    const data = (node.data ?? {}) as Record<string, unknown>;

    // Per-node overrides from data (future: editor exposes these).
    const timeoutMs =
      typeof data._timeoutMs === "number" && data._timeoutMs > 0
        ? data._timeoutMs
        : (def.timeoutMs ?? DEFAULT_NODE_TIMEOUT_MS);

    const retryPolicy = def.defaultRetry ?? {
      maxAttempts: ENGINE_RETRIES,
      backoffMs: DEFAULT_BACKOFF_MS,
    };

    const continueOnFail =
      typeof data._continueOnFail === "boolean" ? data._continueOnFail : false;

    return {
      id: node.id,
      name: node.name,
      type: node.type,
      data,
      timeoutMs,
      retry: retryPolicy,
      continueOnFail,
    };
  });
}

export const executeWorkflow = inngest.createFunction(
  {
    id: "execute-workflow",
    retries: ENGINE_RETRIES,
    concurrency: [
      {
        key: "workflowId",
        limit: 1,
      },
      {
        key: "organizationId",
        limit: 10,
      },
    ],
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

    const { sortedNodes, edges } = await step.run(
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
        const sorted = order
          .map((id) => nodeMap.get(id))
          .filter((n): n is NonNullable<typeof n> => Boolean(n));

        const graphEdges: GraphEdge[] = workflow.connections.map((c) => ({
          fromNodeId: c.fromNodeId,
          toNodeId: c.toNodeId,
          fromOutput: c.fromOutput,
          toInput: c.toInput,
        }));

        return { sortedNodes: sorted, edges: graphEdges };
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

    // Build execution plan with per-node config overrides (AF-M2-04).
    const plan = buildExecutionPlan(sortedNodes);

    // Build graph maps for branch-taken reachability.
    const { adjacency } = buildGraphMaps(edges);
    const allNodeIds = sortedNodes.map((n) => n.id);
    const triggerIds = sortedNodes
      .filter((n) => n.type.endsWith("_TRIGGER"))
      .map((n) => n.id);

    // Track taken edges (AF-M2-04). Starts empty — BFS determines
    // which nodes are reachable.
    const takenEdges = new Set<string>();

    // Initialize context with any initial data from the trigger.
    let context = event.data.initialData || {};
    // Per-node output map for $node["Name"] resolution (AF-M2-03).
    const nodeOutputs: Record<string, Record<string, unknown>> = {};
    const templateMeta = {
      executionId: execution.id,
      workflowId,
    };

    // Track nodes that need a SKIPPED trace written after the loop.
    const skippedNodes: { node: TraceNode; order: number; reason: string }[] =
      [];

    // Execute each node with a per-node trace (AF-A-05). Trace writes are
    // their own steps so they are replay-safe and never re-fire.
    for (const [index, nodeExec] of plan.entries()) {
      const node = sortedNodes[index];

      // AF-M2-04: Branch-taken skip check.
      const skippable = computeSkippableNodes(
        triggerIds,
        takenEdges,
        adjacency,
        allNodeIds,
      );

      if (skippable.has(node.id)) {
        skippedNodes.push({
          node,
          order: index,
          reason: "Skipped: not reachable via taken branches",
        });
        continue;
      }

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

        // AF-M2-03: Build enriched context with $json, $node, $execution,
        // $workflow, $now before passing to the executor.
        const enrichedContext = buildTemplateContext(
          context,
          nodeOutputs,
          templateMeta,
        );

        // AF-M2-04: Per-node retry loop with timeout.
        let result: Record<string, unknown> | undefined;
        let lastError: unknown;
        const { maxAttempts, backoffMs } = nodeExec.retry;

        for (let attemptNum = 1; attemptNum <= maxAttempts; attemptNum++) {
          try {
            // Wrap executor in step.run with a per-node timeout via
            // Promise.race. step.run itself has no timeout option.
            result = (await step.run(
              `node:${node.id}:attempt:${attemptNum}`,
              async () => {
                const executorPromise = execute({
                  data: nodeExec.data,
                  nodeId: node.id,
                  userId,
                  context: enrichedContext,
                  step,
                  publish,
                });

                const timeoutPromise = new Promise<never>((_, reject) => {
                  setTimeout(
                    () =>
                      reject(
                        new Error(
                          `Node "${node.name}" timed out after ${nodeExec.timeoutMs}ms`,
                        ),
                      ),
                    nodeExec.timeoutMs,
                  );
                });

                return Promise.race([executorPromise, timeoutPromise]);
              },
            )) as Record<string, unknown>;
            break; // success — exit retry loop
          } catch (err) {
            lastError = err;
            if (attemptNum < maxAttempts) {
              const delay = backoffMs * 2 ** (attemptNum - 1);
              await step.sleep(`retry-delay:${node.id}:${attemptNum}`, delay);
            }
          }
        }

        if (result === undefined) {
          // All retry attempts exhausted.
          throw lastError;
        }

        // Capture this node's individual output for $node["Name"]
        // resolution in downstream templates.
        nodeOutputs[node.name] = result;
        context = result;

        // AF-M2-04: Mark outgoing edges as taken based on output port.
        const outputPort = (result as Record<string, unknown>)[OUTPUT_PORT_KEY];
        markTakenEdges(
          node.id,
          typeof outputPort === "string" ? outputPort : undefined,
          adjacency,
          takenEdges,
        );

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

        if (nodeExec.continueOnFail) {
          // AF-M2-04: Run continues. Mark outgoing edges as taken so
          // downstream nodes still execute (they receive error output).
          markTakenEdges(node.id, undefined, adjacency, takenEdges);
          continue;
        }

        // Without continueOnFail: stop scheduling. Record remaining
        // nodes as SKIPPED.
        await step.run("trace-skip-remaining", async () => {
          const remaining = sortedNodes.slice(index + 1);
          const rows = remaining.map((n, offset) => ({
            executionId: execution.id,
            nodeId: n.id,
            nodeName: n.name,
            nodeType: n.type,
            status: "SKIPPED" as const,
            attempt: 0,
            order: index + 1 + offset,
            skipReason: "Skipped: an upstream node failed",
          }));
          if (rows.length > 0) {
            await prisma.nodeExecution.createMany({ data: rows });
          }
          return rows.length;
        });

        throw error;
      }
    }

    // Write any skip traces for nodes skipped by branch-taken logic.
    if (skippedNodes.length > 0) {
      await step.run("trace-skip-branches", async () => {
        const rows = skippedNodes.map(({ node: n, order: o, reason }) => ({
          executionId: execution.id,
          nodeId: n.id,
          nodeName: n.name,
          nodeType: n.type,
          status: "SKIPPED" as const,
          attempt: 0,
          order: o,
          skipReason: reason,
        }));
        await prisma.nodeExecution.createMany({ data: rows });
        return rows.length;
      });
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
