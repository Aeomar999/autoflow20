import { type Context, type Handler, NonRetriableError } from "inngest";
import {
  type GraphConnection,
  type GraphNode,
  validate,
} from "@/engine/validate";
import { resolveNodeCredentials } from "@/features/executions/server/credential-resolver";
import { makeResolver } from "@/features/executions/template";
import { notifyExecutionFinished } from "@/features/notifications/server/execution-notifier";
import {
  ExecutionStatus,
  NodeExecutionStatus,
} from "@/generated/prisma/client";
import prisma from "@/lib/db";
import {
  COUNTABLE_EXECUTION_STATUSES,
  evaluateExecutionQuota,
  isMeteredRun,
  quotaBreachMessage,
} from "@/lib/quotas";
import { defaultOutputId } from "@/nodes/ports";
import { getNodeRegistration, nodeRegistry } from "@/nodes/registry";
import { resolveRunPolicy } from "@/nodes/shared/run-policy";
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
import {
  boundTraceValue,
  ENGINE_RETRIES,
  MAX_NODE_OUTPUT_BYTES,
  nodeOutputIsOverLimit,
  serializedBytes,
  truncateStack,
} from "./config";
import {
  buildGraphMaps,
  computeDurationMs,
  computeSkippableNodes,
  extractStepUsage,
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
/** Engine-wide fallbacks, the last step of the AF-M9-06 precedence chain. */
const ENGINE_RUN_DEFAULTS = {
  maxAttempts: ENGINE_RETRIES,
  backoffMs: DEFAULT_BACKOFF_MS,
  timeoutMs: DEFAULT_NODE_TIMEOUT_MS,
};

function buildExecutionPlan(sortedNodes: TraceNode[]): GraphNodeExecution[] {
  return sortedNodes.map((node) => {
    const def = getNodeRegistration(node.type);
    const data = (node.data ?? {}) as Record<string, unknown>;

    // AF-M9-06: one resolver, one documented precedence order —
    // node `_run` > legacy `_timeoutMs`/`_continueOnFail` > definition >
    // engine defaults. Previously inlined here against two undeclared keys.
    const policy = resolveRunPolicy(data, def, ENGINE_RUN_DEFAULTS);

    return {
      id: node.id,
      name: node.name,
      type: node.type,
      data,
      timeoutMs: policy.timeoutMs,
      retry: {
        maxAttempts: policy.maxAttempts,
        backoffMs: policy.backoffMs,
      },
      continueOnFail: policy.continueOnFail,
      disabled: node.disabled === true,
    };
  });
}

export const executeWorkflow = inngest.createFunction(
  {
    id: "execute-workflow",
    retries: ENGINE_RETRIES,
    concurrency: [
      {
        key: "event.data.workflowId",
        limit: 1,
      },
      {
        key: "event.data.organizationId || event.data.userId || event.data.workflowId",
        limit: 10,
      },
    ],
    onFailure: async ({ event }) => {
      const failedExecution = await prisma.execution.findUnique({
        where: { inngestEventId: event.data.event.id },
        select: { id: true, startedAt: true },
      });
      const durationMs = failedExecution
        ? computeDurationMs(failedExecution.startedAt.getTime(), Date.now())
        : null;

      let tokensIn = 0;
      let tokensOut = 0;
      let costUsd = 0;
      if (failedExecution) {
        const aggregates = await prisma.nodeExecution.aggregate({
          where: { executionId: failedExecution.id },
          _sum: { tokensIn: true, tokensOut: true, costUsd: true },
        });
        tokensIn = aggregates._sum.tokensIn ?? 0;
        tokensOut = aggregates._sum.tokensOut ?? 0;
        costUsd =
          aggregates._sum.costUsd != null ? Number(aggregates._sum.costUsd) : 0;
      }

      const updated = await prisma.execution.update({
        where: { inngestEventId: event.data.event.id },
        data: {
          status: ExecutionStatus.FAILED,
          completedAt: new Date(),
          durationMs,
          tokensIn,
          tokensOut,
          costUsd: Math.round(costUsd * 1e6) / 1e6,
          error: event.data.error.message,
          errorStack: truncateStack(event.data.error.stack),
        },
      });

      // AF-M7-08. After the status write, so a notification can never claim a
      // failure the Execution row does not record. `writeNotifications`
      // swallows its own errors, and the dedupe key makes a replayed
      // `onFailure` a no-op rather than a second announcement.
      await notifyExecutionFinished({
        executionId: updated.id,
        succeeded: false,
        error: event.data.error.message,
      });

      return updated;
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
  executeWorkflowHandler as unknown as Handler<
    typeof inngest,
    "workflows/execute.workflow"
  >,
);

/**
 * The `execute-workflow` handler, extracted from `inngest.createFunction` so
 * integration tests can drive the engine directly. As a function declaration it
 * is hoisted, so it can be passed to `createFunction` above without a
 * use-before-declaration error. `publish` is not on the SDK's `Context` (it is
 * injected by the realtime middleware), so it is added to the param type here;
 * the exact realtime signature is recovered at the `createFunction` boundary by
 * the `Handler<typeof inngest, ...>` cast.
 */
export async function executeWorkflowHandler({
  event,
  step,
  publish,
  attempt,
}: Context.Any & {
  publish: (event: unknown) => Promise<{ ids: string[] }>;
}) {
  const inngestEventId = event.id;
  const workflowId = event.data.workflowId;

  if (!inngestEventId || !workflowId) {
    throw new NonRetriableError("Event ID or workflow ID is missing");
  }

  // AF-M7-04: run gate. Runs first so a quota refusal never pays for the
  // create-execution write. A refusal is a normal return (never a throw):
  // the execution row gets a terminal QUOTA_EXCEEDED status + message, and
  // the run stays out of the retry path and out of onFailure. TEST-mode runs
  // (canvas test runs) and the explicit E2E_SERVER bypass never meter.
  const quotaGate = await step.run("quota-gate", async () => {
    const preCreated = event.data.executionId
      ? await prisma.execution.findUnique({
          where: { id: event.data.executionId as string },
          select: { id: true, mode: true },
        })
      : null;
    const mode =
      preCreated?.mode ??
      (event.data.mode as string | undefined) ??
      "PRODUCTION";

    if (!isMeteredRun({ mode, e2eServer: process.env.E2E_SERVER === "1" })) {
      return null;
    }

    const { organizationId } = await prisma.workflow.findUniqueOrThrow({
      where: { id: workflowId },
      select: { organizationId: true },
    });
    const plan = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { plan: true },
    });

    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);

    const current = await prisma.execution.count({
      where: {
        organizationId,
        status: {
          in: [...COUNTABLE_EXECUTION_STATUSES] as ExecutionStatus[],
        },
        startedAt: { gte: monthStart },
      },
    });

    const decision = evaluateExecutionQuota({
      plan: plan?.plan ?? null,
      currentMonthExecutions: current,
    });

    if (decision.allowed) {
      return null;
    }

    return {
      current: decision.current,
      limit: decision.limit,
      plan: plan?.plan ?? null,
      organizationId,
      executionId: preCreated?.id ?? null,
    };
  });

  if (quotaGate) {
    await step.run("fail-quota-exceeded", async () => {
      const finishedAt = new Date();
      const message = quotaBreachMessage(quotaGate.plan, quotaGate.limit);
      if (quotaGate.executionId) {
        return prisma.execution.update({
          where: { id: quotaGate.executionId },
          data: {
            status: ExecutionStatus.QUOTA_EXCEEDED,
            completedAt: finishedAt,
            durationMs: 0,
            error: message,
            errorStack: null,
          },
        });
      }
      return prisma.execution.create({
        data: {
          workflowId,
          inngestEventId,
          trigger: (event.data.trigger as string) || "MANUAL",
          mode: "PRODUCTION",
          status: ExecutionStatus.QUOTA_EXCEEDED,
          organizationId: quotaGate.organizationId,
          completedAt: finishedAt,
          durationMs: 0,
          error: message,
          errorStack: null,
        },
      });
    });

    return {
      workflowId,
      status: ExecutionStatus.QUOTA_EXCEEDED,
    };
  }

  const execution = await step.run("create-execution", async () => {
    // New flow: execution pre-created by workflows.run (AF-M2-06).
    if (event.data.executionId) {
      return prisma.execution.findUniqueOrThrow({
        where: { id: event.data.executionId as string },
      });
    }
    // Legacy flow: create execution from event data.
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
        organizationId: workflow.organizationId,
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
      // Draft test runs (AF-M2-08) carry the graph inline so the run
      // reflects the current canvas, not the persisted workflow.
      const snapshot = (event.data.graphSnapshot ?? null) as {
        nodes?: Array<{
          id: string;
          name: string;
          type: string;
          data?: unknown;
          disabled?: boolean;
        }>;
        connections?: Array<{
          fromNodeId: string;
          toNodeId: string;
          fromOutput?: string;
          toInput?: string;
        }>;
      } | null;
      const useSnapshot = snapshot !== null && Array.isArray(snapshot.nodes);

      let nodeRows: GraphNode[];
      let connectionRows: GraphConnection[];

      if (useSnapshot) {
        nodeRows = (snapshot.nodes ?? []).map((n) => ({
          id: n.id,
          name: n.name,
          type: n.type,
          data: (n.data as Record<string, unknown> | undefined) ?? {},
          disabled: n.disabled === true,
        }));
        connectionRows = (snapshot.connections ?? []).map((c) => ({
          fromNodeId: c.fromNodeId,
          toNodeId: c.toNodeId,
          fromOutput: c.fromOutput ?? "main",
          toInput: c.toInput ?? "main",
        }));
      } else {
        const workflow = await prisma.workflow.findUniqueOrThrow({
          where: { id: workflowId },
          include: {
            nodes: true,
            connections: true,
          },
        });
        nodeRows = workflow.nodes.map((n) => ({
          id: n.id,
          name: n.name,
          type: n.type,
          data: (n.data ?? {}) as Record<string, unknown>,
          disabled: n.disabled,
        }));
        connectionRows = workflow.connections.map((c) => ({
          fromNodeId: c.fromNodeId,
          toNodeId: c.toNodeId,
          fromOutput: c.fromOutput,
          toInput: c.toInput,
        }));
      }

      const { errors, order } = validate(
        { nodes: nodeRows, connections: connectionRows },
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

      const nodeMap = new Map(nodeRows.map((n) => [n.id, n]));
      const sorted = order
        .map((id) => nodeMap.get(id))
        .filter((n): n is NonNullable<typeof n> => Boolean(n));

      const graphEdges: GraphEdge[] = connectionRows.map((c) => ({
        fromNodeId: c.fromNodeId,
        toNodeId: c.toNodeId,
        fromOutput: c.fromOutput,
        toInput: c.toInput,
      }));

      return { sortedNodes: sorted, edges: graphEdges };
    },
  );

  const { userId, organizationId } = await step.run(
    "find-workflow-context",
    async () => {
      const workflow = await prisma.workflow.findUniqueOrThrow({
        where: { id: workflowId },
        select: {
          userId: true,
          organizationId: true,
        },
      });

      return workflow;
    },
  );

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
  const skippedNodes: { node: TraceNode; order: number; reason: string }[] = [];

  // AF-M2-08: Explicit skip/stop policy (retry-from-node, single-node
  // test runs). Nodes in skipNodeSet are marked SKIPPED up front; when
  // endAfterNodeId is set the engine stops scheduling right after it.
  const skipNodeSet = new Set<string>(
    (Array.isArray(event.data.skipNodes)
      ? event.data.skipNodes
      : []) as string[],
  );
  const skipReason = (event.data.skipReason as string | undefined) ?? "";
  const endAfterNodeId =
    (event.data.endAfterNodeId as string | undefined) ?? "";
  const endReason =
    skipReason || "Skipped: test run stopped after the target node";

  // AF-M8-27: Cooperative cancellation. `POST /api/v1/executions/:id/cancel`
  // writes CANCELLED on the row; the run must stop instead of finishing the
  // remaining nodes and overwriting that status with SUCCESS. The final
  // SUCCESS write and success notification are suppressed below so the row
  // keeps the terminal status the caller asked for.
  let cancellationDetected = false;

  /** Rows marking every node after `fromIndex` as SKIPPED (test runs). */
  const remainingSkipRows = (fromIndex: number, reason: string) =>
    sortedNodes.slice(fromIndex + 1).map((n, offset) => ({
      executionId: execution.id,
      nodeId: n.id,
      nodeName: n.name,
      nodeType: n.type,
      status: "SKIPPED" as const,
      attempt: 0,
      order: fromIndex + 1 + offset,
      skipReason: reason,
    }));

  // Execute each node with a per-node trace (AF-A-05). Trace writes are
  // their own steps so they are replay-safe and never re-fire.
  for (const [index, nodeExec] of plan.entries()) {
    const node = sortedNodes[index];

    // AF-M8-27: One replay-safe read per node. Detecting cancellation here
    // bounds the damage to a single node: the run stops scheduling and the
    // unrescheduled nodes are written as SKIPPED.
    const cancelledNow = await step.run(`cancel-check:${node.id}`, async () => {
      const live = await prisma.execution.findUnique({
        where: { id: execution.id },
        select: { status: true },
      });
      return live?.status === ExecutionStatus.CANCELLED;
    });

    if (cancelledNow) {
      cancellationDetected = true;
      skippedNodes.push(
        ...sortedNodes.slice(index).map((n, offset) => ({
          node: n,
          order: index + offset,
          reason: "Skipped: execution cancelled",
        })),
      );
      break;
    }

    // AF-M2-08: Explicit skip (retry-from-node / single-node tests).
    if (skipNodeSet.has(node.id)) {
      skippedNodes.push({
        node,
        order: index,
        reason: skipReason || "Skipped: execution started from a later node",
      });
      continue;
    }

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

    // AF-M9-04 (gap G10): `Node.disabled` has been written by the editor's
    // "Enabled" toggle and persisted by `saveGraph` since M1, and the engine
    // ignored it — a disabled node still ran. Deliberately AFTER the
    // reachability check: a disabled node on an untaken branch is skipped as
    // unreachable, and marking its edges taken there would resurrect the tail
    // of a branch the run never entered.
    //
    // Semantics are n8n's: the node does not execute, and its input passes
    // through to its successors rather than severing the branch. `context` is
    // left untouched, so the next node sees the last executed node's output.
    // Pass-through takes the node's FIRST declared output — for a disabled
    // branching node there is no condition left to evaluate, so "both branches"
    // would be a graph the author never drew.
    if (nodeExec.disabled) {
      skippedNodes.push({
        node,
        order: index,
        reason: "Skipped: node is disabled",
      });
      markTakenEdges(
        node.id,
        defaultOutputId(node.type, node.data),
        adjacency,
        takenEdges,
      );
      continue;
    }

    const { execute, credentials } = getNodeRegistration(node.type);
    // AF-M9-18: The node's input is the flat rolling context it received,
    // captured BEFORE the executor runs (context is reassigned to `result`
    // below). Persisted alongside `result` in `trace-end`.
    const nodeInputValue = context;
    let startedAtMs = Date.now();
    // AF-M9-06: the attempt the node actually finished on. `trace-start` seeds
    // the row with the INNGEST function attempt, which is 1 for every node on a
    // normal run — so without this a node that failed twice and succeeded on the
    // third try recorded `attempt: 1`, leaving the retry invisible in the trace
    // and contradicting "every attempt recorded". Declared out here because the
    // failure path in `catch` records it too.
    let attemptUsed = 1;

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

      // AF-M2-03 builds the enriched view ($json, $node, $execution,
      // $workflow, $now). AF-M9-05: it is captured by `resolveTemplate` and
      // NEVER handed to the executor as `context`. Executors return
      // `{ ...context, … }`, so anything reachable through `context` is
      // persisted into nodeOutputs, Execution.output and every
      // NodeExecution — and `$json` self-references the context, so it
      // re-nested at every hop and the stored payload grew superlinearly.
      const resolveTemplate = makeResolver(context, nodeOutputs, templateMeta);

      // AF-M3-04: Decrypt this node's required credentials exactly once,
      // before execution. The result is passed to the executor and never
      // merged into `context`/`output`/trace, keeping plaintext out of
      // `NodeExecution.input/output`.
      const credentialsForNode = await step.run(
        `resolve-credentials:${node.id}`,
        async () =>
          resolveNodeCredentials({
            requirements: credentials,
            nodeData: nodeExec.data,
            userId,
            loadCredentialRow: async (credentialId) =>
              prisma.credential.findUnique({
                where: { id: credentialId, organizationId },
              }),
          }),
      );

      // AF-M2-04: Per-node retry loop with timeout.
      let result: Record<string, unknown> | undefined;
      let lastError: unknown;
      const { maxAttempts, backoffMs } = nodeExec.retry;

      for (let attemptNum = 1; attemptNum <= maxAttempts; attemptNum++) {
        attemptUsed = attemptNum;
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
                organizationId,
                context,
                resolve: resolveTemplate,
                step,
                publish,
                credentials: credentialsForNode,
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

      // AF-M2-09: Bound node output at the executor boundary so every node
      // type is covered without per-executor changes. Fails loudly rather
      // than letting the run die on an Inngest state/step cap later, and
      // never truncates — a workflow that silently drops half a response
      // produces wrong results that look right.
      const outputBytes = serializedBytes(result);
      if (nodeOutputIsOverLimit(outputBytes)) {
        throw new NonRetriableError(
          `Node "${node.name}" returned ${outputBytes} bytes of output, exceeding the ${MAX_NODE_OUTPUT_BYTES}-byte limit (ADR-0018). Reduce the node's payload or split the workflow into smaller nodes.`,
        );
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

      const usage = extractStepUsage(result);
      await step.run(`trace-end:${node.id}`, async () => {
        const finishedAtMs = Date.now();
        return prisma.nodeExecution.updateMany({
          where: {
            executionId: execution.id,
            nodeId: node.id,
          },
          data: {
            status: NodeExecutionStatus.SUCCESS,
            attempt: attemptUsed,
            finishedAt: new Date(finishedAtMs),
            durationMs: computeDurationMs(startedAtMs, finishedAtMs),
            tokensIn: usage.tokensIn,
            tokensOut: usage.tokensOut,
            costUsd: usage.costUsd,
            cacheHit: usage.cacheHit,
            model: usage.model ?? null,
            // AF-M9-18: Persist the node's resolved input and its return.
            // Bounded by ADR-0018: an over-cap value is stored truncated with an
            // explicit marker, never silently dropped. Both derive from
            // `context`/`result`, which AF-M3-04 guarantees never carry the
            // resolved-credential map, so no secret material reaches the row.
            input: boundTraceValue(nodeInputValue),
            output: boundTraceValue(result),
          },
        });
      });

      // AF-M2-08: Single-node test runs stop right after the target.
      if (endAfterNodeId === node.id) {
        await step.run("trace-skip-test-remaining", async () => {
          const rows = remainingSkipRows(index, endReason);
          if (rows.length > 0) {
            await prisma.nodeExecution.createMany({ data: rows });
          }
          return rows.length;
        });
        break;
      }
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
            attempt: attemptUsed,
            error: message,
            finishedAt: new Date(finishedAtMs),
            durationMs: computeDurationMs(startedAtMs, finishedAtMs),
          },
        });
      });

      // AF-M2-08: A failing test target still stops the run (the test
      // failed) even if the node would normally continue-on-fail.
      if (endAfterNodeId === node.id) {
        await step.run("trace-skip-test-remaining", async () => {
          const rows = remainingSkipRows(index, endReason);
          if (rows.length > 0) {
            await prisma.nodeExecution.createMany({ data: rows });
          }
          return rows.length;
        });
        throw error;
      }

      if (nodeExec.continueOnFail) {
        // AF-M2-04: Run continues. Mark outgoing edges as taken so
        // downstream nodes still execute (they receive error output).
        markTakenEdges(node.id, undefined, adjacency, takenEdges);
        continue;
      }

      // Without continueOnFail: stop scheduling. Record remaining
      // nodes as SKIPPED.
      await step.run("trace-skip-remaining", async () => {
        const rows = remainingSkipRows(
          index,
          "Skipped: an upstream node failed",
        );
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

  // AF-M8-27: When cancellation was detected in the loop, suppress every
  // terminal-STATUS write so the row keeps the CANCELLED status (and
  // completedAt) the cancel route set.
  if (!cancellationDetected) {
    await step.run("update-execution", async () => {
      const finishedAt = new Date();
      const durationMs = computeDurationMs(
        new Date(execution.startedAt).getTime(),
        finishedAt.getTime(),
      );
      const nodeCount = await prisma.nodeExecution.count({
        where: { executionId: execution.id },
      });
      const aggregates = await prisma.nodeExecution.aggregate({
        where: { executionId: execution.id },
        _sum: { tokensIn: true, tokensOut: true, costUsd: true },
      });
      const tokensIn = aggregates._sum.tokensIn ?? 0;
      const tokensOut = aggregates._sum.tokensOut ?? 0;
      const costUsd =
        aggregates._sum.costUsd != null ? Number(aggregates._sum.costUsd) : 0;

      return prisma.execution.update({
        where: { inngestEventId, workflowId },
        data: {
          status: ExecutionStatus.SUCCESS,
          completedAt: finishedAt,
          durationMs,
          nodeCount,
          tokensIn,
          tokensOut,
          costUsd: Math.round(costUsd * 1e6) / 1e6,
          output: context,
        },
      });
    });

    // AF-M7-08. Its own step so Inngest memoizes it: a retry of anything
    // after this point replays the memo instead of re-announcing. Respects
    // the workflow's `notifyOnSuccess`, which defaults OFF.
    await step.run("notify-execution-succeeded", async () =>
      notifyExecutionFinished({
        executionId: execution.id,
        succeeded: true,
      }),
    );
  }

  return cancellationDetected
    ? { workflowId, status: ExecutionStatus.CANCELLED }
    : { workflowId, result: context };
}
