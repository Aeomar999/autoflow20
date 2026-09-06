import { type Context, type Handler, NonRetriableError } from "inngest";
import { planSegments } from "@/engine/segments";
import {
  type GraphConnection,
  type GraphNode,
  validate,
} from "@/engine/validate";
import { resolveNodeCredentials } from "@/features/executions/server/credential-resolver";
import {
  type ItemFanoutScope,
  makeResolver,
} from "@/features/executions/template";
import { notifyExecutionFinished } from "@/features/notifications/server/execution-notifier";
import {
  ExecutionStatus,
  NodeExecutionStatus,
  type Prisma,
} from "@/generated/prisma/client";
import prisma from "@/lib/db";
import {
  COUNTABLE_EXECUTION_STATUSES,
  evaluateExecutionQuota,
  isMeteredRun,
  quotaBreachMessage,
} from "@/lib/quotas";
import { defaultOutputId, inputPorts, outputPorts } from "@/nodes/ports";
import { getNodeRegistration, nodeRegistry } from "@/nodes/registry";
import { resolveRunPolicy } from "@/nodes/shared/run-policy";
import type { StepTools } from "@/nodes/types";
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
  extractWebhookResponse,
  type GraphEdge,
  type GraphNodeExecution,
  markTakenEdges,
  OUTPUT_PORT_KEY,
  SEGMENT_DROP_ITEM_KEY,
  type TraceNode,
  UNMATCHED_OUTPUT_PORT,
  type WebhookResponse,
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

// ---------------------------------------------------------------------------
// AF-M9-12: per-node input resolution from incoming edges
// ---------------------------------------------------------------------------

/**
 * Build a node's resolved input from its incoming edges.
 *
 * One incoming edge → that node's output. Several edges into the same port →
 * merged left-to-right in deterministic edge order. Several ports → keyed by
 * port id (`toInput`). Nodes with no incoming edges (triggers) receive the
 * flat rolling `context` — the initial event data before any node has run.
 */
/**
 * The output port a node declared it took, or `undefined` when it does not
 * branch (AF-M9-16).
 *
 * A node may only route to a port it actually declares. Anything else is
 * either stale state or a bug, and honouring it is uniquely destructive:
 * `markTakenEdges` would match no outgoing edge, so the node's whole
 * downstream becomes unreachable and is skipped — silently, with a run that
 * still reports SUCCESS. Falling back to "non-branching" instead marks the
 * node's edges normally, which is the correct reading of "this node did not
 * choose a branch".
 *
 * The engine's own no-match sentinel is passed through untouched: it means
 * "deliberately route nowhere" and is not a declared port by design.
 */
function declaredOutputPort(
  node: TraceNode,
  result: unknown,
): string | undefined {
  const raw = (result as Record<string, unknown> | null | undefined)?.[
    OUTPUT_PORT_KEY
  ];
  if (typeof raw !== "string") return undefined;
  if (raw === UNMATCHED_OUTPUT_PORT) return raw;
  return outputPorts(node.type, node.data ?? {}).some((p) => p.id === raw)
    ? raw
    : undefined;
}

function buildNodeInput(
  node: TraceNode,
  incoming: Map<string, GraphEdge[]>,
  nodeOutputs: Record<string, Record<string, unknown>>,
  idToName: Map<string, string>,
  fallbackContext: Record<string, unknown>,
): Record<string, unknown> {
  // Merge a list of edges' upstream outputs into one flat object, left to
  // right. Later edges overwrite earlier ones on key collisions (deterministic
  // because edges keep their persisted order).
  const mergeEdges = (portEdges: GraphEdge[]): Record<string, unknown> => {
    const merged: Record<string, unknown> = {};
    for (const edge of portEdges) {
      const upstreamName = idToName.get(edge.fromNodeId);
      const upstreamOutput = upstreamName
        ? nodeOutputs[upstreamName]
        : undefined;
      if (upstreamOutput) {
        Object.assign(merged, upstreamOutput);
      }
    }
    // `_outputPort` is a control signal the engine consumes at the node that
    // PRODUCED it, never data. Copying it downstream was a live defect: every
    // executor returns `{ ...input, … }`, so the node after a CONDITION or
    // SWITCH re-emitted the branch's port id as its own, `markTakenEdges` then
    // matched none of that node's outgoing edges (which are `main`), and its
    // entire downstream was marked "not reachable via taken branches".
    //
    // Concretely: any graph that branched and then REJOINED silently dropped
    // everything after the join — the canonical route-then-respond shape.
    // Found by the AF-M9-16 acceptance suite on W1.
    delete merged[OUTPUT_PORT_KEY];
    // AF-M10-10: same reasoning for the item-drop marker. It is a signal to
    // the segment loop, not data, and leaving it in an input would make a
    // downstream node look like it had dropped its own item.
    delete merged[SEGMENT_DROP_ITEM_KEY];
    return merged;
  };

  // AF-M9-11: a node with config-derived input ports (MERGE v2) receives EVERY
  // declared port as a key — unattached or skipped branches resolve to `null`
  // so the executor can tell "this branch was not taken" from "it produced an
  // empty object" (an empty `{}` would be indistinguishable from a real merge).
  // All other nodes keep the pre-existing flat semantics below; nothing that
  // consumes the flat `context` expects a keyed wrapper.
  if (getNodeRegistration(node.type).resolveInputs) {
    const edges = incoming.get(node.id);
    const result: Record<string, unknown> = {};
    for (const port of inputPorts(node.type, node.data ?? {})) {
      const portEdges = edges?.filter((e) => (e.toInput || "main") === port.id);
      const merged =
        portEdges && portEdges.length > 0 ? mergeEdges(portEdges) : {};
      result[port.id] = Object.keys(merged).length > 0 ? merged : null;
    }
    return result;
  }

  const edges = incoming.get(node.id);
  if (!edges || edges.length === 0) {
    return fallbackContext;
  }

  // Group edges by toInput port.
  const groups = new Map<string, GraphEdge[]>();
  for (const edge of edges) {
    const port = edge.toInput || "main";
    const list = groups.get(port) ?? [];
    list.push(edge);
    groups.set(port, list);
  }

  // Single "main" port: merge directly (flat).
  if (groups.size === 1 && groups.has("main")) {
    const mainEdges = groups.get("main");
    return mainEdges ? mergeEdges(mainEdges) : fallbackContext;
  }

  // Multiple ports: keyed by port id.
  const result: Record<string, unknown> = {};
  for (const [portKey, portEdges] of groups) {
    result[portKey] = mergeEdges(portEdges);
  }
  return result;
}

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
        limit: 5,
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
 * Step tooling for an executor that runs INSIDE the engine's own `step.run`
 * (AF-M10-34).
 *
 * Inngest forbids nested step tooling, and it does not report that by
 * throwing: the nested promise simply never settles, because the SDK ends the
 * request expecting the platform to re-invoke. Handing a wrapped executor the
 * real `step` therefore hangs it until the engine's per-node timeout fires,
 * which is precisely what happened to every workflow before this existed —
 * `MANUAL_TRIGGER` never returned, so no run ever reached node 1.
 *
 * `run` executes inline: the enclosing engine step is already the durability
 * boundary for this node, so an inner one buys nothing. `sleep` and
 * `waitForEvent` are the two that genuinely cannot be faked, so they throw a
 * message naming the fix rather than silently returning and pretending a
 * ten-minute wait happened.
 *
 * `publish` is queued rather than sent, and flushed by the caller once the
 * step has returned. The editor's live node status depends on these events, so
 * dropping them would trade a hang for a dead progress indicator.
 */
function inlineStepTools(
  realPublish: (event: unknown) => Promise<{ ids: string[] }>,
) {
  const queued: unknown[] = [];

  const step = {
    run: async (_name: string, fn: () => unknown) => fn(),
    sleep: async (name: string) => {
      throw new NonRetriableError(
        `A node executor called step.sleep("${name}") while running inside the engine's step. Sleeping durably requires the node's definition to set \`ownsSteps: true\`.`,
      );
    },
    sleepUntil: async (name: string) => {
      throw new NonRetriableError(
        `A node executor called step.sleepUntil("${name}") while running inside the engine's step. Set \`ownsSteps: true\` on the node's definition.`,
      );
    },
    waitForEvent: async (name: string) => {
      throw new NonRetriableError(
        `A node executor called step.waitForEvent("${name}") while running inside the engine's step. Set \`ownsSteps: true\` on the node's definition.`,
      );
    },
    invoke: async (name: string) => {
      throw new NonRetriableError(
        `A node executor called step.invoke("${name}") while running inside the engine's step. Set \`ownsSteps: true\` on the node's definition.`,
      );
    },
    sendEvent: async (_name: string, payload: unknown) => realPublish(payload),
    // `step.ai.wrap(id, fn, ...args)` is how AI_LLM and AI_EXTRACT call the
    // model. It is step tooling too, so inside the engine's step it has to be
    // the plain call. Omitting it is not a safe default: `step.ai` would be
    // undefined and the node would die on "Cannot read properties of
    // undefined (reading 'wrap')" — which is exactly what the first repaired
    // run did, having got past the trigger for the first time.
    ai: {
      wrap: async (
        _id: string,
        fn: (...args: never[]) => unknown,
        ...args: never[]
      ) => fn(...args),
      infer: async (id: string) => {
        throw new NonRetriableError(
          `A node executor called step.ai.infer("${id}") while running inside the engine's step. Set \`ownsSteps: true\` on the node's definition.`,
        );
      },
    },
  } as unknown as StepTools;

  return {
    step,
    publish: async (event: unknown) => {
      queued.push(event);
      return { ids: [] as string[] };
    },
    /** Send what the executor asked to publish, now that the step has ended. */
    flush: async () => {
      for (const event of queued) {
        try {
          await realPublish(event);
        } catch {
          // A dropped status event must never fail a node that succeeded.
        }
      }
      queued.length = 0;
    },
  };
}

type EnginePublish = (event: unknown) => Promise<{ ids: string[] }>;

/**
 * Invoke one node executor on the correct side of the step boundary
 * (AF-M10-34).
 *
 * Two tiers, because "durable" and "retryable" pull in opposite directions
 * here:
 *
 * - A node that owns its steps is awaited DIRECTLY. No wrapper, and
 *   deliberately no timeout race: when such an executor suspends, its promise
 *   never settles — the SDK ends the request and the platform re-invokes —
 *   so racing it against a timer would report a hang for behaviour that is
 *   working exactly as designed. That race is what made every `WAIT` and every
 *   long poll look like a 60-second failure.
 * - Everything else runs INSIDE `step.run`, which is what gives it
 *   memoisation, the per-node timeout and the retry loop. It receives inline
 *   step tooling, because reaching the real `step` from in there is the
 *   nesting Inngest forbids.
 */
async function runNodeExecutor(opts: {
  ownsSteps: boolean;
  stepName: string;
  nodeName: string;
  timeoutMs: number;
  step: StepTools;
  publish: EnginePublish;
  call: (tools: {
    step: StepTools;
    publish: EnginePublish;
  }) => Promise<Record<string, unknown>>;
}): Promise<Record<string, unknown>> {
  if (opts.ownsSteps) {
    return opts.call({ step: opts.step, publish: opts.publish });
  }

  const tools = inlineStepTools(opts.publish);
  try {
    return (await opts.step.run(opts.stepName, async () => {
      const executorPromise = opts.call({
        step: tools.step,
        publish: tools.publish,
      });
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () =>
            reject(
              new Error(
                `Node "${opts.nodeName}" timed out after ${opts.timeoutMs}ms`,
              ),
            ),
          opts.timeoutMs,
        );
      });
      return Promise.race([executorPromise, timeoutPromise]);
    })) as Record<string, unknown>;
  } finally {
    // Outside the step, so the editor still sees what the node published.
    await tools.flush();
  }
}

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

      // AF-UX-06: persist the resolved graph on the execution. Pre-created
      // runs (manual `workflows.run`, public API, retry-from-node) carry no
      // `graphSnapshot` — without this write the run-progress panel has
      // nothing to track. Idempotent for legacy/webhook runs that already
      // stored the snapshot at creation.
      await prisma.execution.update({
        where: { id: execution.id },
        data: {
          graphSnapshot: {
            nodes: nodeRows,
            connections: connectionRows,
          } as Prisma.InputJsonValue,
        },
      });

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
  const { adjacency, incoming } = buildGraphMaps(edges);

  // AF-M9-12: map node IDs to names for edge-derived input resolution.
  const idToName = new Map(sortedNodes.map((n) => [n.id, n.name]));

  const allNodeIds = sortedNodes.map((n) => n.id);
  const triggerIds = sortedNodes
    .filter((n) => n.type.endsWith("_TRIGGER"))
    .map((n) => n.id);

  // Track taken edges (AF-M2-04). Starts empty — BFS determines
  // which nodes are reachable.
  const takenEdges = new Set<string>();

  // AF-M9-14 (ADR-0021): fan-out segment plan. The engine routes a SPLIT_OUT
  // through `runSegment` instead of the single-node path, and tracks every
  // interior + AGGREGATE node it executed so the main loop does not
  // re-process (or re-check reachability on) them. A segment that is skipped
  // (unreachable / disabled / skipNodeSet) does NOT populate this set, so its
  // interior nodes fall through to the normal loop and get a SKIPPED trace.
  const segmentPlan = planSegments(sortedNodes, edges);
  const handledBySegment = new Set<string>();

  // Lookups the AF-M9-14 segment runner uses to fetch a node's registration
  // and config by id without rebuilding them per item.
  const sortedNodeById = new Map(sortedNodes.map((n) => [n.id, n]));
  const sortedNodeIdToIndex = new Map(sortedNodes.map((n, i) => [n.id, i]));
  const nodeExecById = new Map<string, GraphNodeExecution>(
    plan.map((p, i) => [sortedNodes[i].id, p]),
  );

  // AF-M9-14: guarded lookups for nodes the segment planner guarantees exist.
  // An absent entry is an invariant violation (the planner derived the ids from
  // this same node set), so it surfaces as a clean, loud failure — never a
  // silently-undefined lookup that would poison the run.
  const requireSegmentNode = (nodeId: string): TraceNode => {
    const found = sortedNodeById.get(nodeId);
    if (!found) {
      throw new NonRetriableError(
        `Fan-out segment referenced an unknown node (${nodeId}). Re-save the workflow.`,
      );
    }
    return found;
  };
  const requireSegmentExec = (nodeId: string): GraphNodeExecution => {
    const found = nodeExecById.get(nodeId);
    if (!found) {
      throw new NonRetriableError(
        `Fan-out segment referenced an unplanned node (${nodeId}). Re-save the workflow.`,
      );
    }
    return found;
  };
  const requireSegmentIndex = (nodeId: string): number => {
    const found = sortedNodeIdToIndex.get(nodeId);
    if (found === undefined) {
      throw new NonRetriableError(
        `Fan-out segment referenced a node outside the plan (${nodeId}). Re-save the workflow.`,
      );
    }
    return found;
  };

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

  /**
   * Persist a response composed by a RESPOND_TO_WEBHOOK node (AF-M9-10).
   *
   * Written **eagerly**, at the moment the node runs, rather than at settle
   * time. Two reasons, both load-bearing:
   *   - `onFailure` is a separate Inngest context with no access to this
   *     closure, so a settle-time write would silently lose the response
   *     whenever a node downstream of the respond node failed — exactly the
   *     "respond early, then do slow work" shape the node exists to enable.
   *   - it survives cancellation, which suppresses every terminal-status
   *     write (AF-M8-27).
   *
   * Harvested per node rather than read off the terminal context because
   * AF-M9-12 gives each node its own input: a respond node on a branch that
   * is not the last to run would otherwise vanish.
   *
   * Last writer wins. `validate()` warns when two respond nodes are reachable
   * on the same path, so this only decides an ordering the author was already
   * warned about.
   */
  const persistWebhookResponse = async (
    result: unknown,
    stepSuffix: string,
  ): Promise<void> => {
    const composed: WebhookResponse | null = extractWebhookResponse(result);
    if (!composed) return;
    await step.run(`webhook-response:${stepSuffix}`, async () =>
      prisma.execution.update({
        where: { id: execution.id },
        data: {
          // `WebhookResponse` is a closed interface, so it does not satisfy
          // Prisma's `InputJsonValue` index signature structurally. Every
          // field is a JSON primitive — `extractWebhookResponse` narrows each
          // one — so the cast attests a shape already checked, matching how
          // `graphSnapshot` and audit payloads are written.
          response: composed as unknown as Prisma.InputJsonValue,
        },
        select: { id: true },
      }),
    );
  };

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

  // ---------------------------------------------------------------------------
  // AF-M9-14 (ADR-0021): bounded fan-out segment runner
  // ---------------------------------------------------------------------------
  // The main loop executes a SPLIT_OUT by routing it to `runSegment`, which
  // runs the SPLIT_OUT once, then every interior node once per item with
  // `$item` / `$itemIndex` in scope, then closes the AGGREGATE. Participants
  // are recorded in `handledBySegment` so the loop never re-processes them.
  //
  // The per-node mechanics (retry + timeout, credential resolution, output
  // bound, trace start/end) are mirrored from the main loop — keyed to a
  // per-item `itemIndex` — rather than extracted, so the well-tested
  // single-node path (AF-M2-04/08) stays pristine.

  // `runSegmentItemNode`: one node, one item. Mutates `nodeOutputs` (by name)
  // and `takenEdges` like the main path, so a linear interior chain resolves
  // each node's input from the previous node's per-item output and downstream
  // nodes become reachable once the aggregate closes.
  const runSegmentItemNode = async (args: {
    nodeExec: GraphNodeExecution;
    node: TraceNode;
    orderIndex: number;
    itemIndex: number | null;
    itemScope?: ItemFanoutScope;
    // AF-M9-14 / ADR-0021: the AGGREGATE's output is computed by the engine
    // (it closes the segment by collecting per-item outputs), never by the
    // node's own `execute()`. Callers pass it here so the single row (itemIndex
    // null) is still written with the real value, keeping the executions UI in
    // parity with every other box on the canvas.
    overrideOutput?: Record<string, unknown>;
  }): Promise<Record<string, unknown>> => {
    const { nodeExec, node, orderIndex, itemIndex, itemScope, overrideOutput } =
      args;
    const { execute, credentials: credentialsDef } = getNodeRegistration(
      node.type,
    );

    // Edge-derived input like the main loop (AF-M9-12). Interior nodes always
    // have incoming edges, so the flat `{}` fallback is never used.
    const nodeInputValue = buildNodeInput(
      node,
      incoming,
      nodeOutputs,
      idToName,
      {},
    );

    // AF-M9-14: `$item` / `$itemIndex` enter the enriched template scope.
    const resolveTemplate = makeResolver(
      nodeInputValue,
      nodeOutputs,
      templateMeta,
      itemScope,
    );

    let startedAtMs = Date.now();
    let attemptUsed = 1;

    const suffix = itemIndex === null ? "root" : String(itemIndex);

    await step.run(`segment-trace-start:${node.id}:${suffix}`, async () => {
      // A replayed attempt may have left a FAILED row for this exact item;
      // replace it so this attempt starts from a clean RUNNING state. Scoped
      // to `itemIndex` so it never touches another item's rows for the node.
      const where = {
        executionId: execution.id,
        nodeId: node.id,
        itemIndex,
      };
      await prisma.nodeExecution.deleteMany({ where });
      const row = await prisma.nodeExecution.create({
        data: {
          executionId: execution.id,
          nodeId: node.id,
          nodeName: node.name,
          nodeType: node.type,
          status: NodeExecutionStatus.RUNNING,
          attempt,
          order: orderIndex,
          itemIndex,
        },
      });
      startedAtMs = row.startedAt.getTime();
    });

    // When `overrideOutput` is supplied (AGGREGATE), the engine already produced
    // the value — skip credential resolution and the execute/retry loop entirely,
    // but still run the shared output-bound + trace-end tail below.
    let result: Record<string, unknown> | undefined;
    let lastError: unknown;

    if (overrideOutput !== undefined) {
      result = overrideOutput;
    } else {
      // AF-M3-04: decrypt this node's required credentials exactly once.
      const credentialsForNode = await step.run(
        `segment-resolve-credentials:${node.id}:${suffix}`,
        async () =>
          resolveNodeCredentials({
            requirements: credentialsDef,
            nodeData: nodeExec.data,
            userId,
            loadCredentialRow: async (credentialId) =>
              prisma.credential.findUnique({
                where: { id: credentialId, organizationId },
              }),
          }),
      );

      // AF-M2-04: per-node retry loop with timeout.
      const { backoffMs } = nodeExec.retry;
      // AF-M10-34: a node that owns its steps opts out of the retry loop. Both
      // the retry and the timeout are built on racing the executor's promise,
      // and re-entering such an executor would replay step names Inngest has
      // already memoised, handing it the first attempt's answer.
      const ownsSteps = getNodeRegistration(node.type).ownsSteps === true;
      const maxAttempts = ownsSteps ? 1 : nodeExec.retry.maxAttempts;

      for (let attemptNum = 1; attemptNum <= maxAttempts; attemptNum++) {
        attemptUsed = attemptNum;
        try {
          result = await runNodeExecutor({
            ownsSteps,
            stepName: `segment-node:${node.id}:${suffix}:attempt:${attemptNum}`,
            nodeName: node.name,
            timeoutMs: nodeExec.timeoutMs,
            step,
            publish,
            call: (tools) =>
              execute({
                data: nodeExec.data,
                nodeId: node.id,
                workflowId,
                executionId: execution.id,
                userId,
                organizationId,
                context: nodeInputValue,
                resolve: resolveTemplate,
                step: tools.step,
                publish: tools.publish,
                credentials: credentialsForNode,
                // AF-M10-10: the current item as a value, for nodes whose
                // BEHAVIOUR changes inside a segment rather than whose text
                // does. `itemScope` is undefined for the SPLIT_OUT and the
                // AGGREGATE themselves, which is correct — neither is per-item.
                ...(itemScope && itemIndex !== null
                  ? { item: { value: itemScope.$item, index: itemIndex } }
                  : {}),
              }),
          });
          break;
        } catch (err) {
          lastError = err;
          if (attemptNum < maxAttempts) {
            const delay = backoffMs * 2 ** (attemptNum - 1);
            await step.sleep(
              `segment-retry-delay:${node.id}:${suffix}:${attemptNum}`,
              delay,
            );
          }
        }
      }

      if (result === undefined) {
        throw lastError;
      }
    }

    // AF-M2-09: bound node output at the executor boundary.
    const outputBytes = serializedBytes(result);
    if (nodeOutputIsOverLimit(outputBytes)) {
      throw new NonRetriableError(
        `Node "${node.name}" returned ${outputBytes} bytes of output, exceeding the ${MAX_NODE_OUTPUT_BYTES}-byte limit (ADR-0018). Reduce the node's payload or split the workflow into smaller nodes.`,
      );
    }

    nodeOutputs[node.name] = result;

    // AF-M9-10: a respond node inside a fan-out segment composes one response
    // per item; the last item's wins, matching the last-writer rule outside a
    // segment. Authors are warned off this shape by `validate()`.
    await persistWebhookResponse(result, `${node.id}:${suffix}`);

    // AF-M2-04: mark outgoing edges taken based on output port, so the
    // downstream of this segment becomes reachable.
    markTakenEdges(
      node.id,
      declaredOutputPort(node, result),
      adjacency,
      takenEdges,
    );

    const usage = extractStepUsage(result);
    await step.run(`segment-trace-end:${node.id}:${suffix}`, async () => {
      const finishedAtMs = Date.now();
      return prisma.nodeExecution.updateMany({
        where: {
          executionId: execution.id,
          nodeId: node.id,
          itemIndex,
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
          input: boundTraceValue(nodeInputValue),
          output: boundTraceValue(result),
        },
      });
    });

    return result;
  };

  // `runSegment`: drive one SPLIT_OUT segment to completion.
  const runSegment = async (
    splitExec: GraphNodeExecution,
    splitNode: TraceNode,
    splitIndex: number,
  ): Promise<void> => {
    const segment = segmentPlan.segments.find(
      (s) => s.splitNodeId === splitNode.id,
    );
    if (!segment) return;

    // Run the SPLIT_OUT once (retry/timeout/credentials/output-bound/trace),
    // then read `{ items, count }` from its output to size the fan-out.
    const splitOutput = await runSegmentItemNode({
      nodeExec: splitExec,
      node: splitNode,
      orderIndex: splitIndex,
      itemIndex: null,
    });

    const items = Array.isArray(splitOutput.items)
      ? (splitOutput.items as unknown[])
      : null;
    if (!items) {
      throw new NonRetriableError(
        `SPLIT_OUT "${splitNode.name}" produced no array to iterate.`,
      );
    }

    // AF-M9-14: hard cap. Exceeding it fails the whole run cleanly rather than
    // truncating the array (a half-fanned run reported as success is the exact
    // failure ADR-0021 forbids).
    const rawCap = Number(splitExec.data?.maxItems);
    const maxItems =
      Number.isFinite(rawCap) && (rawCap as number) > 0
        ? Math.min(1000, Math.floor(rawCap as number))
        : 100;
    if (items.length > maxItems) {
      throw new NonRetriableError(
        `SPLIT_OUT "${splitNode.name}" produced ${items.length} items, exceeding its ${maxItems}-item cap (maxItems). The run stopped cleanly; raise the node's cap or reduce the array.`,
      );
    }

    // The whole segment is handled here — the main loop must never re-run
    // these nodes (and never re-check their reachability, which would see
    // their edges already marked taken anyway).
    for (const interiorId of segment.interiorNodeIds) {
      handledBySegment.add(interiorId);
    }
    handledBySegment.add(segment.aggregateNodeId);

    const aggregateNode = requireSegmentNode(segment.aggregateNodeId);
    const count = items.length;
    const succeededOutputs: unknown[] = [];
    const failedIndices: number[] = [];
    /** Items a FILTER/DEDUPE removed (AF-M10-10) — not failures. */
    const droppedIndices: number[] = [];

    // Sequential per-item execution (ADR-0021 explicitly rules out parallel
    // items). `continueOnFail` on an interior node lets a failing item move on
    // without aborting the run; the item's index is recorded as failed and the
    // rest of the chain for that item is skipped.
    for (let i = 0; i < count; i++) {
      const item = items[i];
      let itemOutput: unknown = item; // identity when there are no interior nodes
      let itemFailed = false;
      let itemDropped = false;

      for (const interiorId of segment.interiorNodeIds) {
        const interiorNode = requireSegmentNode(interiorId);
        const interiorExec = requireSegmentExec(interiorId);
        const interiorIndex = requireSegmentIndex(interiorId);
        try {
          itemOutput = await runSegmentItemNode({
            nodeExec: interiorExec,
            node: interiorNode,
            orderIndex: interiorIndex,
            itemIndex: i,
            itemScope: { $item: item, $itemIndex: i },
          });

          // AF-M10-10: FILTER and DEDUPE drop an item by returning
          // `_dropItem`. The item is neither collected nor recorded as failed
          // — it was handled correctly and simply should not continue. Its
          // node rows stay SUCCESS, so the trace shows exactly where it left.
          if (
            itemOutput !== null &&
            typeof itemOutput === "object" &&
            (itemOutput as Record<string, unknown>)[SEGMENT_DROP_ITEM_KEY] ===
              true
          ) {
            itemDropped = true;
            break;
          }
        } catch (error) {
          if (interiorExec.continueOnFail) {
            // Record the item as failed and write a FAILED trace-end for this
            // interior node's item row (runSegmentItemNode left it RUNNING
            // when it threw). Scoped to `itemIndex` so it never touches
            // another item's rows for the same node.
            itemFailed = true;
            failedIndices.push(i);
            const message =
              error instanceof Error ? error.message : String(error);
            await step.run(
              `segment-trace-fail:${interiorId}:${i}`,
              async () => {
                return prisma.nodeExecution.updateMany({
                  where: {
                    executionId: execution.id,
                    nodeId: interiorNode.id,
                    itemIndex: i,
                  },
                  data: {
                    status: NodeExecutionStatus.FAILED,
                    error: message,
                    finishedAt: new Date(),
                  },
                });
              },
            );
            break;
          }
          throw error;
        }
      }

      if (!itemFailed && !itemDropped) {
        succeededOutputs.push(itemOutput);
      }
      if (itemDropped) {
        droppedIndices.push(i);
      }
    }

    // AGGREGATE contract (AF-M9-14 / ADR-0021): `{ items, count, failed }`.
    // Every box on the canvas maps to at least one inspectable row (the
    // AGGREGATE node itself gets one row, itemIndex null, via runSegmentItemNode
    // below, keyed through the normal edge-derived write path).
    const aggregateResult = {
      items: succeededOutputs,
      count,
      failed: failedIndices,
      // AF-M10-10. Reported separately from `failed` because "filtered out" and
      // "blew up" are different outcomes, and a template that branches on
      // `failed.length` must not see a deliberate filter as an error.
      dropped: droppedIndices,
    };

    // Make the aggregate resolvable + reachable downstream exactly like the
    // main loop would for any executed node. It gets its own single row
    // (itemIndex null) via runSegmentItemNode — which also sets its output in
    // `nodeOutputs` and marks its edges — while the engine-supplied value is
    // passed through `overrideOutput` (its own `execute()` is only a contract
    // fallback). The flat context then carries the collection downstream.
    const aggregateExec = requireSegmentExec(segment.aggregateNodeId);
    const aggregateIndex = requireSegmentIndex(segment.aggregateNodeId);
    await runSegmentItemNode({
      nodeExec: aggregateExec,
      node: aggregateNode,
      orderIndex: aggregateIndex,
      itemIndex: null,
      overrideOutput: aggregateResult,
    });
    context = aggregateResult;
  };

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

    // AF-M9-14 (ADR-0021): an interior or AGGREGATE node already executed by
    // `runSegment` for every item (which also marked its edges taken) must not
    // be re-run or double-checked by the main loop. Sits before `skipNodeSet`
    // so a `runSegment`'d node is never re-scheduled.
    if (handledBySegment.has(node.id)) {
      continue;
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

    // AF-M9-12: The node's input is resolved from its incoming edges —
    // one incoming edge → that node's output; several into one port →
    // merged left-to-right in deterministic edge order; several ports →
    // keyed by port id. Nodes with no incoming edges (triggers) receive
    // the flat rolling `context` (initial event data). Computed before the
    // disabled check so a skipped node can record its pass-through input.
    const nodeInputValue = buildNodeInput(
      node,
      incoming,
      nodeOutputs,
      idToName,
      context,
    );

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
      // Crucial for AF-M9-12 edge resolution: successors build their input
      // from `nodeOutputs`, so a disabled node must expose its pass-through
      // value there (its resolved input) rather than being absent — otherwise
      // the branch would appear severed and downstream inputs collapse to {}.
      nodeOutputs[node.name] = nodeInputValue;
      markTakenEdges(
        node.id,
        defaultOutputId(node.type, node.data),
        adjacency,
        takenEdges,
      );
      continue;
    }

    // AF-M9-14 (ADR-0021): fan-out segment start. When the loop reaches a
    // SPLIT_OUT on a reachable path (it has passed the skip/reachability/
    // disabled checks above), run the whole segment — SPLIT_OUT once, then each
    // interior node once per item with $item/$itemIndex in scope, then the
    // AGGREGATE — instead of this single-node path. All segment participants
    // are recorded in `handledBySegment` so the loop skips them.
    if (segmentPlan.segmentStartIds.has(node.id)) {
      await runSegment(nodeExec, node, index);
      continue;
    }

    const { execute, credentials } = getNodeRegistration(node.type);
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
      // AF-M9-12: the enriched view is built from this node's edge-derived
      // input, so templates resolve against per-node input (not the flat
      // rolling context).
      const resolveTemplate = makeResolver(
        nodeInputValue,
        nodeOutputs,
        templateMeta,
      );

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
      const { backoffMs } = nodeExec.retry;
      // AF-M10-34: see the segment path — a node that owns its steps runs
      // outside the wrapper and therefore outside the retry loop too.
      const ownsSteps = getNodeRegistration(node.type).ownsSteps === true;
      const maxAttempts = ownsSteps ? 1 : nodeExec.retry.maxAttempts;

      for (let attemptNum = 1; attemptNum <= maxAttempts; attemptNum++) {
        attemptUsed = attemptNum;
        try {
          result = await runNodeExecutor({
            ownsSteps,
            stepName: `node:${node.id}:attempt:${attemptNum}`,
            nodeName: node.name,
            timeoutMs: nodeExec.timeoutMs,
            step,
            publish,
            call: (tools) =>
              execute({
                data: nodeExec.data,
                nodeId: node.id,
                workflowId,
                executionId: execution.id,
                userId,
                organizationId,
                context: nodeInputValue,
                resolve: resolveTemplate,
                step: tools.step,
                publish: tools.publish,
                credentials: credentialsForNode,
              }),
          });
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

      // AF-M9-10: persist a composed synchronous webhook response, if this
      // node was a RESPOND_TO_WEBHOOK. Cheap key probe for every other node.
      await persistWebhookResponse(result, node.id);

      // AF-M2-04: Mark outgoing edges as taken based on output port.
      markTakenEdges(
        node.id,
        declaredOutputPort(node, result),
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
