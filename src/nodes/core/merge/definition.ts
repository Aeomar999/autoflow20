import { z } from "zod";
import type { NodeDefinition, PortDef } from "@/nodes/types";

/**
 * Merge node: combines data from multiple upstream branches (AF-M9-11, v2).
 *
 * v2 adds `byInput` mode and a configurable `inputCount` (2–5) of input ports,
 * rendered as `input-0…input-n` on the canvas (n8n convention). Before this, a
 * MERGE had a single `main` input and mode `append`/`mergeByKey`/`combine`.
 *
 * Modes:
 * - "byInput" (v2): produces `{ input0, input1, … }` — each upstream branch
 *   under a key derived from its port index (the W2 shape). An unattached or
 *   skipped branch appears as `null`, not a missing key.
 * - "append": concatenates arrays from all inputs.
 * - "mergeByKey": deep-merges objects, with later inputs overriding earlier.
 * - "combine": single-key object of every input (v1 legacy, kept executable).
 *
 * Almost all of the mode logic lives in `execute.ts`; this file owns only the
 * config shape, the port resolution, and the v1→v2 migration.
 */

/** All modes, including the legacy "combine" preserved for saved v1 nodes. */
export const mergeModes = [
  "byInput",
  "append",
  "mergeByKey",
  "combine",
] as const;
export type MergeMode = (typeof mergeModes)[number];

export const configSchema = z.object({
  /**
   * Merge strategy. `combine` is retained as a valid value so saved v1 nodes
   * keep executing, but it is not offered by the v2 config UI (a new node
   * cannot be created in `combine` mode).
   */
  mode: z.enum(mergeModes).optional(),
  /**
   * (v2) Number of input ports, 2–5. Drives `resolveInputs`, which emits
   * `input-0…input-{n-1}`. Absent on a saved v1 node; `migrate` fills it.
   */
  inputCount: z.number().int().min(2).max(5).optional(),
  /**
   * For "combine" mode: the key each upstream node's output is placed under.
   * If not set, uses the upstream node name.
   */
  combineKey: z.string().max(64).optional(),
});

export type MergeData = z.infer<typeof configSchema>;

export const definition: NodeDefinition = {
  type: "MERGE",
  version: 2,
  category: "LOGIC",
  label: "Merge",
  description:
    "Combine data from multiple upstream branches (by input port, append, or merge by key).",
  icon: "Merge",
  keywords: ["merge", "combine", "join", "concat", "byInput", "branch"],
  configSchema,
  defaults: { mode: "byInput", inputCount: 2 },
  // Inputs are config-dependent: their count is set by `inputCount`. Declared
  // empty; `resolveInputs` is the single source of truth for the port set
  // (mirror of SWITCH's `resolveOutputs`).
  inputs: [],
  resolveInputs: (config) => resolveInputs(config),
  outputs: [{ id: "main", label: "Out" }],
  /**
   * v1→v2: a saved v1 node carries `{ mode, combineKey }` but no `inputCount`.
   * Backfill the default port count so `resolveInputs` can render ports; the
   * mode and combineKey pass through untouched.
   */
  migrate: (config, fromVersion) => {
    const data = (config ?? {}) as Record<string, unknown>;
    if (fromVersion < 2) {
      return {
        ...(data as MergeData),
        // v1 defaulted to "append" when no mode was chosen; preserve that so a
        // truly-legacy node does not silently switch to the v2 "byInput"
        // default on load.
        mode: typeof data.mode === "string" ? data.mode : "append",
        inputCount: typeof data.inputCount === "number" ? data.inputCount : 2,
      };
    }
    return data as MergeData;
  },
};

/**
 * The single port-resolution path for MERGE (AF-M9-11). Emits `input-0…
 * input-{count-1}` where `count` is `inputCount` (default 2). Runs identically
 * on the server (compile/edge matching) and the client (canvas handle
 * rendering) because both go through `inputPorts("MERGE", config)` and this is
 * side-effect free.
 */
export function resolveInputs(config: unknown): PortDef[] {
  const data = (config ?? {}) as MergeData;
  const count = data.inputCount ?? 2;
  return Array.from({ length: count }, (_, i) => ({
    id: `input-${i}`,
    label: `In ${i + 1}`,
    description: `Data from branch ${i + 1}`,
  }));
}

/**
 * Map a port id to the W2 byInput output key: `input-0` → `input0`, `input-1`
 * → `input1`, … (the dash is the canvas handle convention; the byInput result
 * drops it).
 */
export function byInputKey(portId: string): string {
  return portId.replace(/^input-(\d+)$/, "input$1");
}
