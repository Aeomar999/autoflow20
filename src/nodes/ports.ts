import { findManifestEntry } from "./manifest";
import type { PortDef } from "./types";

/**
 * Port resolution for a node type (AF-M9-03).
 *
 * `PortDef.id` is the React Flow handle id AND the persisted
 * `Connection.fromOutput` / `Connection.toInput` (`docs/architecture/node_sdk.md`).
 * Before AF-M9-03 the canvas rendered one hardcoded `source-1`/`target-1` pair per
 * node and the save boundary persisted those literals, so a branching node's
 * `_outputPort` (`"true"`/`"false"`) could never match an edge and the engine marked
 * the whole downstream `SKIPPED`. Every surface that needs a node's ports now
 * resolves them here, so there is one answer rather than three.
 *
 * Client-safe: imports only `manifest.ts` (definitions), never `registry.ts`
 * (implementations). Usable from editor components, the save boundary, and
 * migration scripts alike.
 */

/** What an unregistered type falls back to, so an unknown node still connects. */
export const DEFAULT_INPUT: PortDef = { id: "main", label: "In" };
export const DEFAULT_OUTPUT: PortDef = { id: "main", label: "Out" };

/**
 * Handle ids the pre-AF-M9-03 canvas emitted. Persisted rows still carry them
 * until the data migration runs, and an old browser tab can still send them, so
 * both the migration and `normalizePortId` translate rather than reject.
 */
export const LEGACY_SOURCE_HANDLE = "source-1";
export const LEGACY_TARGET_HANDLE = "target-1";

/**
 * Declared input ports for `type`.
 *
 * A trigger legitimately declares `inputs: []`; that empty array is returned as-is.
 * The `DEFAULT_INPUT` fallback applies only to a type the manifest does not know,
 * which would otherwise render a node nothing can connect to.
 */
export function inputPorts(type: string): PortDef[] {
  const def = findManifestEntry(type);
  if (!def) return [DEFAULT_INPUT];
  return def.inputs;
}

/**
 * Resolved output ports for `type` (AF-M9-09).
 *
 * This is the SINGLE shared resolution path for a node's output ports. A node
 * with config-dependent output ports (SWITCH, SPLIT_OUT) implements
 * `resolveOutputs(config)` on its definition; this helper routes through it
 * whenever it is present, and falls back to the static `outputs` array for
 * every other node. The editor (handle rendering), the validator (orphaned-edge
 * checks) and the engine (edge matching / disabled pass-through) all call here,
 * so a node's ports cannot drift between surfaces.
 *
 * `config` is typically the node's `data`. It is optional: static-`outputs`
 * nodes never need it, and callers that have not yet loaded a node's data can
 * pass `undefined` to get the static ports (or the defaults-derived empty set
 * for a `resolveOutputs` node using its config defaults).
 */
export function outputPorts(type: string, config?: unknown): PortDef[] {
  const def = findManifestEntry(type);
  if (!def) return [DEFAULT_OUTPUT];
  if (def.resolveOutputs) return def.resolveOutputs(config as never);
  return def.outputs;
}

/**
 * The port an edge attaches to when the user has not picked one — appending a
 * node from the `+` affordance, or dropping a connection on the node body.
 *
 * Deliberately the FIRST declared port, not `"main"`: a CONDITION declares
 * `true`/`false` and has no `main`, so appending from one must land on `true`
 * (the affirmative branch) rather than inventing a port that does not exist.
 */
export function defaultOutputId(type: string, config?: unknown): string {
  return outputPorts(type, config)[0]?.id ?? DEFAULT_OUTPUT.id;
}

/** The port an incoming edge attaches to by default. See `defaultOutputId`. */
export function defaultInputId(type: string): string {
  return inputPorts(type)[0]?.id ?? DEFAULT_INPUT.id;
}

/**
 * Translate a possibly-legacy handle id into a real declared port id.
 *
 * Returns `null` when the id is neither legacy nor declared, so callers can
 * decide: the migration reports it and leaves the row alone, rather than
 * silently rewiring an edge to a port its author never chose.
 */
export function normalizePortId(
  type: string,
  handleId: string | null | undefined,
  direction: "source" | "target",
): string | null {
  const ports = direction === "source" ? outputPorts(type) : inputPorts(type);

  // No handle recorded at all — the pre-port-aware default.
  if (!handleId) return ports[0]?.id ?? null;

  // Already a declared port: leave it exactly as authored.
  if (ports.some((p) => p.id === handleId)) return handleId;

  const legacy =
    direction === "source" ? LEGACY_SOURCE_HANDLE : LEGACY_TARGET_HANDLE;
  if (handleId === legacy) return ports[0]?.id ?? null;

  return null;
}

/** The canvas edge shape every caller here starts from (React Flow's). */
export interface EdgePorts {
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

/**
 * Resolve a canvas edge to the `{ fromOutput, toInput }` pair that gets
 * persisted and that the engine matches against.
 *
 * Used by the save boundary and the test-run planner so validation, persistence,
 * and execution cannot disagree about a port's name. A browser tab opened before
 * AF-M9-03 still posts `source-1`/`target-1`, so this translates rather than
 * rejects; an id that is neither legacy nor declared is passed through unchanged
 * so `validate()` reports it instead of this quietly rewiring the user's edge.
 */
export function resolveEdgePorts(
  edge: EdgePorts,
  typeOf: (nodeId: string) => string | undefined,
): { fromOutput: string; toInput: string } {
  const sourceType = typeOf(edge.source) ?? "";
  const targetType = typeOf(edge.target) ?? "";

  return {
    fromOutput:
      normalizePortId(sourceType, edge.sourceHandle, "source") ??
      edge.sourceHandle ??
      DEFAULT_OUTPUT.id,
    toInput:
      normalizePortId(targetType, edge.targetHandle, "target") ??
      edge.targetHandle ??
      DEFAULT_INPUT.id,
  };
}

/**
 * Vertical offset for handle `index` of `total`, as a CSS `top` percentage.
 *
 * One handle sits centred (the pre-AF-M9-03 look, so single-port nodes are
 * pixel-identical); N handles are evenly spaced at (i+1)/(N+1).
 */
export function handleOffset(index: number, total: number): string {
  if (total <= 1) return "50%";
  return `${((index + 1) / (total + 1)) * 100}%`;
}
