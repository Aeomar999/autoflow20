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
 * Convention for token & cost capture across nodes (AF-M5-05).
 * Nodes performing AI calls or metering attach this to the returned context.
 */
export const WORKFLOW_USAGE_KEY = "__usage" as const;

export interface StepUsage {
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  model?: string;
}

/**
 * Extracts and sanitizes token usage and cost metrics from a node's return context.
 */
export function extractStepUsage(result: unknown): StepUsage {
  if (!result || typeof result !== "object") {
    return { tokensIn: 0, tokensOut: 0, costUsd: 0 };
  }
  const rec = result as Record<string, unknown>;
  const rawUsage = (rec[WORKFLOW_USAGE_KEY] ?? rec._usage) as
    | Record<string, unknown>
    | undefined;
  if (!rawUsage || typeof rawUsage !== "object") {
    return { tokensIn: 0, tokensOut: 0, costUsd: 0 };
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
