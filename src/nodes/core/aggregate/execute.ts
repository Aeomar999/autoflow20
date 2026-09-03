import "server-only";
import type { NodeRun } from "@/nodes/types";
import type { AggregateConfig } from "./definition";

/**
 * Aggregated fan-out segment output (AF-M9-14, ADR-0021).
 */
export interface AggregateResult {
  /** The per-item outputs the segment produced, in item order (or the item itself when the interior produced nothing). */
  items: unknown[];
  /** Number of items iterated. */
  count: number;
  /** Indices of items that failed under continueOnFail, or [] when none. */
  failed: number[];
}

/**
 * AGGREGATE execute (AF-M9-14).
 *
 * The engine executes a fan-out segment as a unit and writes the aggregated
 * result directly as this node's recorded output, so this executor is never
 * reached through the single-node path (validate.ts guarantees an AGGREGATE
 * only exists paired with a SPLIT_OUT). It exists to satisfy the node
 * contract and to return a well-formed empty aggregate if ever invoked
 * directly, so nothing downstream can observe an undefined shape.
 */
export const execute: NodeRun<AggregateConfig> = async () => {
  return { items: [], count: 0, failed: [] } satisfies AggregateResult;
};
