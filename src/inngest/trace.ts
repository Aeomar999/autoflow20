/**
 * Per-node execution traces (AF-A-05).
 *
 * Pure row-building helpers so the Inngest function only makes thin
 * Prisma calls inside steps. Deliberately does NOT import
 * @/generated/prisma - that CJS client fails to resolve under Vitest,
 * so these helpers stay unit-testable without a database.
 */

/** Mirrors the generated NodeExecutionStatus enum (string-valued). */
export type TraceStatus = "RUNNING" | "SUCCESS" | "FAILED" | "SKIPPED";

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
