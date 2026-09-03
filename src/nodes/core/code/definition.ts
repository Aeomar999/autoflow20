import { z } from "zod";
import type { NodeDefinition } from "@/nodes/types";

/**
 * Code node (AF-M9-13): run user-authored JavaScript against the resolved node
 * input inside a hardened sandbox (worker thread + `node:vm` — see ADR-0020).
 *
 * The user's `code` is the BODY of an async function `(input) => { … }` where
 * `input` is this node's resolved context (frozen, read-only). It returns
 * either an object (merged into the node output) or an array (stored under
 * `items` for the downstream SPLIT_OUT contract).
 *
 * The sandbox exposes no host bindings — no `require`, `import`, `process`,
 * `fetch`, timers, filesystem or network — and is bounded by hard caps
 * (wall clock, heap, output) that are configurable per node within the
 * ceilings declared here. Every breach is a loud `NonRetriableError`.
 *
 * The defaults and ceilings live here (this file is isomorphic) so the editor
 * can validate limit pickers against the same constants the server enforces.
 */

/** Wall-clock cap for one Code execution: default 5s, ceiling 30s. */
export const CODE_WALL_CLOCK_DEFAULT_MS = 5_000;
export const CODE_WALL_CLOCK_CEILING_MS = 30_000;

/** Heap cap for one Code execution: default 64 MB, ceiling 256 MB. */
export const CODE_HEAP_DEFAULT_MB = 64;
export const CODE_HEAP_CEILING_MB = 256;

/** Output byte cap for one Code execution: default == ceiling == 1 MB. */
export const CODE_OUTPUT_DEFAULT_BYTES = 1_048_576;
export const CODE_OUTPUT_CEILING_BYTES = 1_048_576;

/** Max length of the user's code body. */
export const CODE_BODY_MAX_CHARS = 100_000;

export const configSchema = z.object({
  /** Body of `(input) => { … }`; the only runtime the user controls. */
  code: z.string().min(1).max(CODE_BODY_MAX_CHARS),
  /**
   * (Optional) per-node override of the sandbox's default wall-clock cap, in
   * milliseconds, clamped to `[1, CODE_WALL_CLOCK_CEILING_MS]` at run time.
   * Absent → `CODE_WALL_CLOCK_DEFAULT_MS`.
   */
  limitTimeoutMs: z
    .number()
    .int()
    .min(1)
    .max(CODE_WALL_CLOCK_CEILING_MS)
    .optional(),
  /**
   * (Optional) per-node override of the sandbox's default heap cap, in MB,
   * clamped to `[1, CODE_HEAP_CEILING_MB]` at run time.
   * Absent → `CODE_HEAP_DEFAULT_MB`.
   */
  limitHeapMb: z.number().int().min(1).max(CODE_HEAP_CEILING_MB).optional(),
  /**
   * (Optional) per-node override of the sandbox's default output cap, in
   * bytes, clamped to `[1024, CODE_OUTPUT_CEILING_BYTES]` at run time.
   * Absent → `CODE_OUTPUT_DEFAULT_BYTES`.
   */
  limitOutputBytes: z
    .number()
    .int()
    .min(1024)
    .max(CODE_OUTPUT_CEILING_BYTES)
    .optional(),
});

export type CodeData = z.infer<typeof configSchema>;

export const definition: NodeDefinition = {
  type: "CODE",
  version: 1,
  category: "TRANSFORM",
  label: "Code",
  description:
    "Run custom JavaScript against the resolved input inside a hardened sandbox.",
  icon: "Code",
  keywords: ["code", "js", "javascript", "transform", "script", "function"],
  configSchema,
  defaults: { code: "" },
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
};
