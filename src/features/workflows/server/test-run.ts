/**
 * Draft test-run planning (AF-M2-08).
 *
 * Pure planning (no DB, no Inngest) so it is unit-testable: turns the
 * current canvas draft into the graph snapshot the engine should execute,
 * and derives the skip/stop policy for whole-workflow and single-node
 * test runs.
 */

import { validate } from "@/engine/validate";
import { computeSkipNodes } from "@/features/executions/server/executions-router-helpers";
import { resolveEdgePorts } from "@/nodes/ports";
import { nodeRegistry } from "@/nodes/registry";

/** Loose shape accepted from the client canvas (React Flow nodes/edges). */
export type DraftNode = {
  id: string;
  type: string;
  data?: unknown;
  /** Persisted `Node.disabled` (AF-M9-04); the engine skips these. */
  disabled?: boolean;
};

export type DraftEdge = {
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
};

export type GraphNode = {
  id: string;
  name: string;
  type: string;
  data: Record<string, unknown>;
  disabled?: boolean;
};

export type GraphConnection = {
  fromNodeId: string;
  toNodeId: string;
  fromOutput: string;
  toInput: string;
};

/** The compaction shape carried in the execution + inngest event. */
export type TestGraph = {
  nodes: GraphNode[];
  connections: GraphConnection[];
};

export type TestRunPlan = {
  graphSnapshot: TestGraph;
  /** Node ids the engine must mark SKIPPED before the test target. */
  skipNodes: string[];
  /** When set, the engine stops scheduling after this node completes. */
  endAfterNodeId?: string;
  /** Reason written on every node skipped by a test run. */
  skipReason?: string;
};

export class TestRunError extends Error {}

/**
 * Normalize canvas nodes/edges into the graph snapshot compaction.
 * Node `name` mirrors what `saveGraph` persists (the node type).
 */
export function buildTestGraph(
  nodes: DraftNode[],
  edges: DraftEdge[],
): TestGraph {
  // AF-M9-03: resolve handles through the same path `saveGraph` uses, so an
  // in-editor test run takes the same branch the saved workflow would.
  const typeOfNode = (nodeId: string) =>
    nodes.find((n) => n.id === nodeId)?.type;

  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      name: n.type,
      type: n.type,
      data: (n.data as Record<string, unknown> | null | undefined) ?? {},
      disabled: n.disabled === true,
    })),
    connections: edges.map((e) => ({
      fromNodeId: e.source,
      toNodeId: e.target,
      ...resolveEdgePorts(e, typeOfNode),
    })),
  };
}

/**
 * Plan a whole-draft test run: validate the draft graph up front so the
 * caller can reject with a clear message instead of a mid-run failure.
 * No node short-circuiting — every reachable node runs.
 */
export function buildTestRunPlan(graph: TestGraph): TestRunPlan {
  assertValidGraph(graph);
  return { graphSnapshot: graph, skipNodes: [] };
}

/**
 * Plan a single-node test run: only `targetNodeId` executes. Every node
 * that topological-sorts before the target is skipped, and the engine
 * stops straight after the target (endAfterNodeId), skipping the rest.
 */
export function buildNodeTestRunPlan(
  graph: TestGraph,
  targetNodeId: string,
): TestRunPlan {
  const target = graph.nodes.find((n) => n.id === targetNodeId);
  if (!target) {
    throw new TestRunError(`Node "${targetNodeId}" not found in the draft`);
  }

  assertValidGraph(graph);

  const skipNodes = computeSkipNodes(graph, targetNodeId);
  return {
    graphSnapshot: graph,
    skipNodes,
    endAfterNodeId: targetNodeId,
    skipReason: `Skipped: test run only targets node "${target.name}"`,
  };
}

function assertValidGraph(graph: TestGraph): void {
  const { errors } = validate(
    {
      nodes: graph.nodes,
      connections: graph.connections,
    },
    nodeRegistry,
  );
  const critical = errors.filter((e) => e.severity === "error");
  if (critical.length > 0) {
    throw new TestRunError(
      `Graph validation failed: ${critical.map((e) => e.message).join("; ")}`,
    );
  }
}
