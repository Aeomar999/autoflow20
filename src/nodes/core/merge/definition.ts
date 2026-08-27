import { z } from "zod";
import type { NodeDefinition } from "@/nodes/types";

/**
 * Merge node: combines data from upstream nodes.
 *
 * Modes:
 * - "append": concatenates arrays from all inputs.
 * - "mergeByKey": deep-merges objects, with later inputs overriding earlier.
 * - "combine": creates a single object with each input under a configurable key.
 */
export const configSchema = z.object({
  mode: z.enum(["append", "mergeByKey", "combine"]).optional(),
  /**
   * For "combine" mode: the key name under which each upstream node's
   * output is placed. If not set, uses the upstream node name.
   */
  combineKey: z.string().max(64).optional(),
});

export type MergeData = z.infer<typeof configSchema>;

export const definition: NodeDefinition = {
  type: "MERGE",
  version: 1,
  category: "LOGIC",
  label: "Merge",
  description:
    "Combine data from multiple upstream branches (append, merge by key, or combine).",
  icon: "Merge",
  keywords: ["merge", "combine", "join", "concat", "branch"],
  configSchema,
  defaults: {},
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
};
