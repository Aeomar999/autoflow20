import {
  type GraphConnection,
  type GraphNode,
  validate,
} from "@/engine/validate";

/**
 * Run-progress helper for the execution detail page (AF-UX-06).
 *
 * Computes a compact progress summary from an execution's persisted graph
 * snapshot and its node traces. Pure and DB-free: the server reads the row
 * and node executions, then delegates entirely to this function. It reuses
 * the engine's deterministic topological `validate` order so the node list
 * matches the order the runner executed.
 */

export interface ExecutionFlowNode {
  id: string;
  name: string;
  type: string;
}

export interface ExecutionFlow {
  /** Number of nodes in the graph snapshot (topological order length). */
  total: number;
  /** Distinct nodeIds that reached a terminal state (SUCCESS/FAILED/SKIPPED). */
  done: number;
  /** 0..100, rounded; 100 for an empty graph; capped at 100. */
  percent: number;
  /** Deterministic execution order (node ids); snapshot order fallback. */
  order: string[];
  /** Node labels in `order`, for rendering rows that have no trace row yet. */
  nodes: ExecutionFlowNode[];
}

const TERMINAL_STATUSES = new Set(["SUCCESS", "FAILED", "SKIPPED"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

/**
 * @param graphSnapshot Raw `Execution.graphSnapshot` JSON (may be null for
 *   executions created before AF-UX-06, or for a run that never prepared).
 * @param nodeExecutions Ordered node trace rows for the same execution.
 */
export function computeExecutionFlow(
  graphSnapshot: unknown,
  nodeExecutions: ReadonlyArray<{ nodeId: string | null; status: string }>,
): ExecutionFlow {
  const snapshot = (graphSnapshot ?? null) as {
    nodes?: unknown;
    connections?: unknown;
  } | null;
  const rawNodes = Array.isArray(snapshot?.nodes) ? snapshot.nodes : [];
  const rawConnections = Array.isArray(snapshot?.connections)
    ? snapshot.connections
    : [];

  // Defensive normalization: snapshots are arbitrary JSON, so coerce every
  // field before handing the graph to the engine's validator.
  const nodes: GraphNode[] = [];
  const nodeMeta = new Map<string, ExecutionFlowNode>();
  for (const raw of rawNodes) {
    if (!isRecord(raw)) continue;
    const id = asString(raw.id, "");
    if (!id) continue;
    const type = asString(raw.type, "node");
    const name = asString(raw.name, type);
    nodes.push({
      id,
      name,
      type,
      data: isRecord(raw.data) ? raw.data : {},
      disabled: raw.disabled === true,
    });
    nodeMeta.set(id, { id, name, type });
  }

  const connections: GraphConnection[] = [];
  for (const raw of rawConnections) {
    if (!isRecord(raw)) continue;
    const fromNodeId = asString(raw.fromNodeId, "");
    const toNodeId = asString(raw.toNodeId, "");
    if (!fromNodeId || !toNodeId) continue;
    connections.push({
      fromNodeId,
      toNodeId,
      fromOutput: asString(raw.fromOutput, "main"),
      toInput: asString(raw.toInput, "main"),
    });
  }

  // Deterministic topological order (isolated and disabled nodes included),
  // matching the order the runner executed. On a cyclic or malformed graph
  // `validate` returns no order (it reports the errors), so fall back to the
  // snapshot's node order — stable, and the panel still renders.
  let order: string[] = [];
  if (nodes.length > 0) {
    order = validate({ nodes, connections }).order;
    if (order.length === 0) {
      order = nodes.map((n) => n.id);
    }
  }

  // A node is "done" once it reached a terminal state. Segment interior nodes
  // write one NodeExecution row per item, so count by distinct nodeId and only
  // for nodes that still exist in the order (stale traces after a graph edit
  // must not move the bar). RUNNING/WAITING rows are not done.
  const inGraph = new Set(order);
  const done = new Set<string>();
  for (const trace of nodeExecutions) {
    if (
      trace.nodeId &&
      inGraph.has(trace.nodeId) &&
      TERMINAL_STATUSES.has(trace.status)
    ) {
      done.add(trace.nodeId);
    }
  }

  const total = order.length;
  const percent =
    total === 0 ? 100 : Math.min(100, Math.round((done.size / total) * 100));

  return {
    total,
    done: done.size,
    percent,
    order,
    nodes: order
      .map((id) => nodeMeta.get(id))
      .filter((n): n is ExecutionFlowNode => Boolean(n)),
  };
}
