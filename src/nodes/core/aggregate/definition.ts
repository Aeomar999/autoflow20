import { z } from "zod";
import type { NodeDefinition } from "@/nodes/types";

/**
 * AGGREGATE (AF-M9-14, ADR-0021): the close of a bounded fan-out segment.
 *
 * Collects the per-item outputs produced by the segment's interior nodes and
 * returns `{ items, count, failed }` — the per-item outputs (or the item
 * itself when the interior produced nothing), the number of items, and the
 * indices of items that failed under `continueOnFail`. Downstream nodes
 * consume this aggregated object, so the graph continues linearly.
 *
 * A valid graph pairs every AGGREGATE with exactly one SPLIT_OUT (see
 * `src/engine/validate.ts`); the engine executes the whole segment as a unit
 * and sets this node's recorded output, so the executor here is a contract
 * fallback and is never invoked through the single-node path.
 */
export const configSchema = z.object({}).default({});

export type AggregateConfig = z.infer<typeof configSchema>;

export const definition: NodeDefinition = {
  type: "AGGREGATE",
  version: 1,
  category: "TRANSFORM",
  label: "Aggregate",
  description:
    "Close a fan-out segment, collecting each item's output into { items, count, failed }.",
  icon: "List",
  keywords: ["aggregate", "collect", "join", "fan-in", "foreach", "loop"],
  configSchema,
  defaults: {},
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
};
