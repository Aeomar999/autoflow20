import { createId } from "@paralleldrive/cuid2";
import toposort from "toposort";
import type { Connection, Node } from "@/generated/prisma/client";
import { inngest } from "./client";

export const topologicalSort = (
  nodes: Node[],
  connections: Connection[],
): Node[] => {
  // If no connections, return node as-is (they're all independent)
  if (connections.length === 0) {
    return nodes;
  }

  // Create edges array for toposort
  const edges: [string, string][] = connections.map((conn) => [
    conn.fromNodeId,
    conn.toNodeId,
  ]);

  // Perform topological sort
  let sortedNodeIds: string[];
  try {
    sortedNodeIds = toposort(edges);
    // Remove duplicates
    sortedNodeIds = [...new Set(sortedNodeIds)];
  } catch (error) {
    if (error instanceof Error && error.message.includes("Cyclic")) {
      throw new Error("Workflow contains a cycle");
    }
    throw error;
  }

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const sorted = sortedNodeIds
    .map((id) => nodeMap.get(id))
    .filter((n): n is Node => Boolean(n));

  // Nodes with no connections never appear in toposort output; appending them
  // keeps them in the run without the false-cycle a self-edge would cause.
  const sortedIds = new Set(sortedNodeIds);
  for (const node of nodes) {
    if (!sortedIds.has(node.id)) {
      sorted.push(node);
    }
  }

  return sorted;
};

export const sendWorkflowExecution = async (data: {
  workflowId: string;
  initialData?: Record<string, unknown>;
}) => {
  return inngest.send({
    name: "workflows/execute.workflow",
    data,
    id: createId(),
  });
};
