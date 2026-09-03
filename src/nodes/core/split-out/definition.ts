import { z } from "zod";
import type { NodeDefinition } from "@/nodes/types";

/**
 * SPLIT_OUT (AF-M9-14, ADR-0021): the open of a bounded fan-out segment.
 *
 * Reads an array at a configured dot-path in the node's resolved input and
 * produces `{ items, count }`. The engine iterates the array once per item,
 * running every node between this SPLIT_OUT and its paired AGGREGATE with
 * `$item` / `$itemIndex` in scope, then aggregates into the closing node.
 *
 * `maxItems` bounds the fan-out (default 100, engine ceiling 1000). Exceeding
 * it fails the run — never a partial run reported as success.
 */
export const configSchema = z.object({
  /** Dot-path to the array to iterate, resolved against the node's input. */
  path: z
    .string()
    .refine((v) => v.length > 0, "Array path must not be empty")
    .max(1024),
  /** Hard per-segment item cap. Values above the engine ceiling are clamped by the engine. */
  maxItems: z.number().int().min(1).max(1000).default(100),
});

export type SplitOutConfig = z.infer<typeof configSchema>;

export const definition: NodeDefinition = {
  type: "SPLIT_OUT",
  version: 1,
  category: "TRANSFORM",
  label: "Split Out",
  description:
    "Iterate an array: run the nodes between this and its AGGREGATE once per item, with $item in scope.",
  icon: "ListTree",
  keywords: [
    "split",
    "iterate",
    "loop",
    "fan-out",
    "foreach",
    "array",
    "batch",
  ],
  configSchema,
  defaults: { path: "", maxItems: 100 },
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
};
