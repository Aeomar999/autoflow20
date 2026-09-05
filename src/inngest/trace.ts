/**
 * Per-node execution traces (AF-A-05) + runner helpers (AF-M2-04).
 *
 * Pure row-building and reachability helpers so the Inngest function only
 * makes thin Prisma calls inside steps. Deliberately does NOT import
 * @/generated/prisma - that CJS client fails to resolve under Vitest,
 * so these helpers stay unit-testable without a database.
 */

/** Mirrors the generated NodeExecutionStatus enum (string-valued). */
export type TraceStatus =
  | "RUNNING"
  | "SUCCESS"
  | "FAILED"
  | "SKIPPED"
  | "CANCELLED"
  | "TIMED_OUT";

export type TraceNode = {
  id: string;
  name: string;
  type: string;
  data: unknown;
  /** Persisted `Node.disabled` (AF-M9-04). */
  disabled?: boolean;
};

export type NodeExecutionRow = {
  executionId: string;
  nodeId: string;
  nodeName: string;
  nodeType: string;
  status: TraceStatus;
  attempt: number;
  order: number;
  error?: string;
  skipReason?: string;
};

/**
 * Per-node execution config extracted from the graph snapshot.
 * Carries the fields the engine needs at runtime to enforce
 * timeouts, retries, and branch-taken semantics.
 */
export type GraphNodeExecution = {
  id: string;
  name: string;
  type: string;
  data: Record<string, unknown>;
  /** Wall-clock cap per attempt in ms (default 60 000). */
  timeoutMs: number;
  /** Retry policy override (per-node or inherit from ENGINE_RETRIES). */
  retry: { maxAttempts: number; backoffMs: number };
  /** When true, a failed node is recorded FAILED but the run continues. */
  continueOnFail: boolean;
  /**
   * When true the executor is never invoked: the node is traced `SKIPPED` and
   * its input passes through to its successors (AF-M9-04).
   */
  disabled: boolean;
};

/**
 * An edge in the graph, keyed by `fromNodeId:fromOutput` for fast lookup
 * when mapping output ports to downstream connections.
 */
export type GraphEdge = {
  fromNodeId: string;
  toNodeId: string;
  fromOutput: string;
  toInput: string;
};

/**
 * The convention for branching nodes (condition, switch, etc.):
 * the executor returns `_outputPort` in the context to tell the
 * engine which output was taken. Non-branching nodes omit it;
 * the engine treats them as always taking their sole "main" output.
 */
export const OUTPUT_PORT_KEY = "_outputPort" as const;

/**
 * Reserved `_outputPort` value a branching node returns to signal "no branch
 * was taken" (AF-M9-09). SWITCH emits it when no rule matched and its
 * `fallback` is `"none"`. `markTakenEdges` treats it specially: it marks NO
 * outgoing edge, so every downstream node is `SKIPPED` via reachability and
 * the run still ends `SUCCESS` (a SWITCH that deliberately routes to nobody is
 * not a failure). It must never be a legal user-facing output port id — the
 * SWITCH `configSchema` forbids it as an `outputKey`, so no authored edge can
 * collide with the sentinel. It is guaranteed non-empty so the normal
 * `if (outputPort)` branching path never treats it as an implicit "main".
 */
export const UNMATCHED_OUTPUT_PORT = "__switch_unmatched__" as const;

/**
 * Convention for dropping the current item inside a fan-out segment
 * (AF-M10-10).
 *
 * An interior node that returns this key tells the segment loop: stop the
 * chain for THIS item and do not collect its output. `FILTER` uses it when an
 * item does not match, `DEDUPE` when it has been seen before.
 *
 * It is deliberately not an error and deliberately not `continueOnFail`: the
 * item was handled correctly and simply should not continue, so it belongs in
 * neither the `failed` list nor the collected `items`. A fully-filtered
 * segment produces `{ items: [], count: N, failed: [] }` and the run ends
 * `SUCCESS` — filtering everything out is an answer, not a failure.
 *
 * Outside a segment the key is inert; a top-level `FILTER` filters an array.
 */
export const SEGMENT_DROP_ITEM_KEY = "_dropItem" as const;

/**
 * Convention for token & cost capture across nodes (AF-M5-05).
 * Nodes performing AI calls or metering attach this to the returned context.
 */
export const WORKFLOW_USAGE_KEY = "__usage" as const;

/**
 * Convention for the synchronous webhook response (AF-M9-10).
 * `RESPOND_TO_WEBHOOK` attaches the composed response here; the engine
 * harvests it at each node boundary and writes the last one seen to
 * `Execution.response`, which the webhook route returns verbatim in
 * `?sync=true` mode.
 *
 * Harvested at the node boundary rather than read off the terminal context
 * because AF-M9-12 gives each node its own input: a respond node on a branch
 * that is not the last to run would otherwise be invisible at settle time.
 */
export const WEBHOOK_RESPONSE_KEY = "__webhookResponse" as const;

/** Hard cap on a composed response body (AF-M9-10). Rejected, never truncated. */
export const MAX_WEBHOOK_RESPONSE_BYTES = 1_000_000;

/**
 * A response composed by `RESPOND_TO_WEBHOOK`, as persisted on
 * `Execution.response` and returned by the webhook route.
 */
export interface WebhookResponse {
  statusCode: number;
  contentType: string;
  /** Already allowlist-filtered by the node; the route filters again. */
  headers: Record<string, string>;
  body: string;
}

/**
 * Read a composed webhook response off a node's returned context.
 *
 * Returns `null` for every node that is not a respond node, which is the
 * overwhelming majority — so this is a cheap key probe, not a validation
 * pass. The shape was already validated by the executor that produced it;
 * this only guards against a malformed value reaching the DB column.
 */
export function extractWebhookResponse(
  result: unknown,
): WebhookResponse | null {
  if (!result || typeof result !== "object") return null;
  const raw = (result as Record<string, unknown>)[WEBHOOK_RESPONSE_KEY];
  if (!raw || typeof raw !== "object") return null;

  const rec = raw as Record<string, unknown>;
  const statusCode = rec.statusCode;
  const body = rec.body;
  if (typeof statusCode !== "number" || typeof body !== "string") return null;

  const headers: Record<string, string> = {};
  if (rec.headers && typeof rec.headers === "object") {
    for (const [key, value] of Object.entries(
      rec.headers as Record<string, unknown>,
    )) {
      if (typeof value === "string") headers[key] = value;
    }
  }

  return {
    statusCode,
    contentType:
      typeof rec.contentType === "string"
        ? rec.contentType
        : "application/json",
    headers,
    body,
  };
}

export interface StepUsage {
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  model?: string;
  /**
   * Response-cache outcome (AF-M5-07): true = served from cache, false = the
   * node had a cache configured and missed, null = no cache configured, so
   * the run belongs in neither half of a hit rate.
   */
  cacheHit: boolean | null;
}

/**
 * Extracts and sanitizes token usage and cost metrics from a node's return context.
 */
export function extractStepUsage(result: unknown): StepUsage {
  if (!result || typeof result !== "object") {
    return { tokensIn: 0, tokensOut: 0, costUsd: 0, cacheHit: null };
  }
  const rec = result as Record<string, unknown>;
  const rawUsage = (rec[WORKFLOW_USAGE_KEY] ?? rec._usage) as
    | Record<string, unknown>
    | undefined;
  if (!rawUsage || typeof rawUsage !== "object") {
    return { tokensIn: 0, tokensOut: 0, costUsd: 0, cacheHit: null };
  }
  const tokensIn =
    typeof rawUsage.tokensIn === "number" && !Number.isNaN(rawUsage.tokensIn)
      ? Math.max(0, Math.round(rawUsage.tokensIn))
      : typeof rawUsage.inputTokens === "number" &&
          !Number.isNaN(rawUsage.inputTokens)
        ? Math.max(0, Math.round(rawUsage.inputTokens))
        : typeof rawUsage.promptTokens === "number" &&
            !Number.isNaN(rawUsage.promptTokens)
          ? Math.max(0, Math.round(rawUsage.promptTokens))
          : 0;

  const tokensOut =
    typeof rawUsage.tokensOut === "number" && !Number.isNaN(rawUsage.tokensOut)
      ? Math.max(0, Math.round(rawUsage.tokensOut))
      : typeof rawUsage.outputTokens === "number" &&
          !Number.isNaN(rawUsage.outputTokens)
        ? Math.max(0, Math.round(rawUsage.outputTokens))
        : typeof rawUsage.completionTokens === "number" &&
            !Number.isNaN(rawUsage.completionTokens)
          ? Math.max(0, Math.round(rawUsage.completionTokens))
          : 0;

  const costUsd =
    typeof rawUsage.costUsd === "number" && !Number.isNaN(rawUsage.costUsd)
      ? Math.max(0, Math.round(rawUsage.costUsd * 1e6) / 1e6)
      : 0;

  const model = typeof rawUsage.model === "string" ? rawUsage.model : undefined;

  return {
    tokensIn,
    tokensOut,
    costUsd,
    model,
    cacheHit: typeof rawUsage.cacheHit === "boolean" ? rawUsage.cacheHit : null,
  };
}

// ---------------------------------------------------------------------------
// Skip-reachability (branch-taken semantics, AF-M2-04)
// ---------------------------------------------------------------------------

/**
 * Compute the set of node IDs that should be SKIPPED because no
 * path from the trigger reaches them through taken edges.
 *
 * A node is "reachable" when there exists a path from any trigger
 * to it consisting entirely of edges in `takenEdges`. Triggers
 * themselves are always reachable.
 *
 * @param triggerIds - node ids of trigger nodes (always reachable).
 * @param takenEdges - set of `"fromNodeId:fromOutput"` strings
 *   representing edges whose output port was exercised.
 * @param adjacency  - map from node id to its outgoing edges.
 * @param allNodeIds - every node id in the graph (to include isolated).
 * @returns Set of node ids that should be skipped.
 */
export function computeSkippableNodes(
  triggerIds: string[],
  takenEdges: Set<string>,
  adjacency: Map<string, GraphEdge[]>,
  allNodeIds: string[],
): Set<string> {
  const reachable = new Set<string>();
  const queue: string[] = [];

  // Triggers are always reachable.
  for (const id of triggerIds) {
    reachable.add(id);
    queue.push(id);
  }

  // BFS along taken edges.
  while (queue.length > 0) {
    const current = queue[0];
    queue.shift();
    for (const edge of adjacency.get(current) ?? []) {
      const edgeKey = `${edge.fromNodeId}:${edge.fromOutput}`;
      if (takenEdges.has(edgeKey) && !reachable.has(edge.toNodeId)) {
        reachable.add(edge.toNodeId);
        queue.push(edge.toNodeId);
      }
    }
  }

  // Everything not reachable is skippable.
  const skippable = new Set<string>();
  for (const id of allNodeIds) {
    if (!reachable.has(id)) {
      skippable.add(id);
    }
  }
  return skippable;
}

/**
 * After a node executes, mark its outgoing edges as taken based on
 * the output port it declared (or the sole "main" output for
 * non-branching nodes).
 *
 * @param nodeId - the node that just executed.
 * @param outputPort - the value of `_outputPort` from the node's
 *   return context, or undefined for non-branching nodes.
 * @param adjacency - map from node id to outgoing edges.
 * @param takenEdges - mutable set to add taken edge keys to.
 */
export function markTakenEdges(
  nodeId: string,
  outputPort: string | undefined,
  adjacency: Map<string, GraphEdge[]>,
  takenEdges: Set<string>,
): void {
  const edges = adjacency.get(nodeId) ?? [];
  if (edges.length === 0) return;

  if (outputPort === UNMATCHED_OUTPUT_PORT) {
    // No branch taken (AF-M9-09): a SWITCH with `fallback: "none"` matched no
    // rule. Mark nothing — no downstream edge is exercised, so every node
    // below the SWITCH becomes SKIPPED by reachability. Deliberately checked
    // BEFORE the generic `if (outputPort)` branch below, which would otherwise
    // match zero edges anyway; this early return is the explicit contract so
    // the behaviour is pinned by tests and can't silently change.
    return;
  }

  if (outputPort) {
    // Branching node: mark only edges from the declared output port.
    for (const edge of edges) {
      if (edge.fromOutput === outputPort) {
        takenEdges.add(`${edge.fromNodeId}:${edge.fromOutput}`);
      }
    }
  } else {
    // Non-branching node: mark all edges (they share the implicit
    // "main" output). If a node has a single output named "main"
    // or any other name, mark it.
    for (const edge of edges) {
      takenEdges.add(`${edge.fromNodeId}:${edge.fromOutput}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Build helpers
// ---------------------------------------------------------------------------

/** Rows for every node at/after `fromIndex` in the topological order -
 * they never ran because an upstream node failed. */
export function buildSkippedTraces(
  sortedNodes: TraceNode[],
  fromIndex: number,
  executionId: string,
  reason: string,
): NodeExecutionRow[] {
  return sortedNodes.slice(fromIndex).map((node, offset) => ({
    executionId,
    nodeId: node.id,
    nodeName: node.name,
    nodeType: node.type,
    status: "SKIPPED" as const,
    attempt: 0,
    order: fromIndex + offset,
    skipReason: reason,
  }));
}

export function computeDurationMs(
  startedAtMs: number,
  finishedAtMs: number,
): number {
  return Math.max(0, Math.round(finishedAtMs - startedAtMs));
}

// ---------------------------------------------------------------------------
// Adjacency helpers (used by the engine to build the maps above)
// ---------------------------------------------------------------------------

/**
 * Build an adjacency map (node id → outgoing edges) and an incoming
 * map (node id → incoming edges) from a flat list of connections.
 */
export function buildGraphMaps(edges: GraphEdge[]): {
  adjacency: Map<string, GraphEdge[]>;
  incoming: Map<string, GraphEdge[]>;
} {
  const adjacency = new Map<string, GraphEdge[]>();
  const incoming = new Map<string, GraphEdge[]>();

  for (const edge of edges) {
    const fromList = adjacency.get(edge.fromNodeId);
    if (fromList) {
      fromList.push(edge);
    } else {
      adjacency.set(edge.fromNodeId, [edge]);
    }

    const toList = incoming.get(edge.toNodeId);
    if (toList) {
      toList.push(edge);
    } else {
      incoming.set(edge.toNodeId, [edge]);
    }
  }

  return { adjacency, incoming };
}
