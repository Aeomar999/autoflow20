/**
 * Shared helpers for the executions tRPC router (AF-M2-06).
 * Extracted for independent testability.
 */

export const retryableStatuses = ["FAILED", "TIMED_OUT", "CANCELLED"];

type Snapshot = {
  nodes?: Array<{ id: string }>;
  connections?: Array<{ fromNodeId: string; toNodeId: string }>;
};

/**
 * BFS from triggers (in-degree 0) in topological order. Returns the
 * list of node IDs that come *before* `targetNodeId`, which should
 * be skipped when retrying from that node.
 */
export function computeSkipNodes(
  snapshot: Snapshot | null | undefined,
  targetNodeId: string,
): string[] {
  if (!snapshot?.nodes || !snapshot?.connections) return [];

  const nodeIds = snapshot.nodes.map((n) => n.id);
  if (!nodeIds.includes(targetNodeId)) return [];

  const inDegree = new Map<string, number>();
  for (const id of nodeIds) inDegree.set(id, 0);
  for (const conn of snapshot.connections) {
    inDegree.set(conn.toNodeId, (inDegree.get(conn.toNodeId) ?? 0) + 1);
  }

  const adj = new Map<string, string[]>();
  for (const id of nodeIds) adj.set(id, []);
  for (const conn of snapshot.connections) {
    adj.get(conn.fromNodeId)?.push(conn.toNodeId);
  }

  const skipNodes: string[] = [];
  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    if (current === targetNodeId) break;
    skipNodes.push(current);
    for (const next of adj.get(current) ?? []) {
      const newDeg = (inDegree.get(next) ?? 1) - 1;
      inDegree.set(next, newDeg);
      if (newDeg === 0) queue.push(next);
    }
  }

  return skipNodes;
}
