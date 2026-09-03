import type { Graph, ValidationRegistry } from "@/engine/validate";
import { findManifestEntry } from "@/nodes/manifest";
import { resolveEdgePorts } from "@/nodes/ports";

/**
 * Client-side catalogue adapter + canvas-draft converter (AF-M1-07).
 *
 * Lets the shared graph validator (`@/engine/validate`) lint the live canvas
 * draft exactly the way the server validates on save. Two shims over the
 * manifest:
 *
 *  - legacy `INITIAL` nodes (persisted until the M1-02 row migration re-runs)
 *    resolve as `MANUAL_TRIGGER`, mirroring the server registry's alias. The
 *    "type ends with _TRIGGER" check stays naming-based on both sides, so an
 *    INITIAL-only canvas still lints "no trigger" — parity with saveGraph.
 *  - unknown types throw: `checkConfigs` / `checkRequiredInputs` already wrap
 *    `resolve` in try/catch, so the throw surfaces as a lint error instead of
 *    crashing the canvas.
 */
export const clientNodeRegistry: ValidationRegistry = {
  has(type: string): boolean {
    return resolveDefinition(type) !== undefined;
  },
  resolve(type: string) {
    const definition = resolveDefinition(type);
    if (!definition) {
      throw new Error(`Unknown node type: "${type}".`);
    }
    return {
      configSchema: definition.configSchema,
      inputs: definition.inputs,
    };
  },
};

function resolveDefinition(type: string) {
  if (type === "INITIAL") {
    return findManifestEntry("MANUAL_TRIGGER");
  }
  return findManifestEntry(type);
}

/**
 * Structural subset of the React Flow draft node (`EditorNode`) accepted by
 * `toGraph`, kept local so this module never imports the atoms store (the
 * derived `validationResultAtom` imports BOTH and would otherwise form a cycle).
 */
type CanvasNodeLike = {
  id: string;
  type?: string | null;
  name?: string | null;
  data?: Record<string, unknown> | null;
  /** AF-M9-04: a disabled node is exempt from config/required-input lint. */
  disabled?: boolean;
};

type CanvasEdgeLike = {
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
};

/**
 * Convert a React Flow draft back into the validator's `Graph`. Handle
 * resolution MUST mirror the server (saveGraph in
 * `src/features/workflows/server/routers.ts` and `buildTestGraph` in
 * `src/features/workflows/server/test-run.ts`) — the client lint is only useful
 * if it reports what the server would reject. Since AF-M9-03 all three share
 * `resolveEdgePorts`, so "mirror" is enforced by the code rather than by this
 * comment.
 */
export function toGraph(
  nodes: CanvasNodeLike[],
  edges: CanvasEdgeLike[],
): Graph {
  const typeOfNode = (nodeId: string) =>
    nodes.find((n) => n.id === nodeId)?.type ?? undefined;

  return {
    nodes: nodes.map((node) => ({
      id: node.id,
      name: node.name ?? node.type ?? node.id,
      type: node.type ?? "UNKNOWN",
      data: node.data ?? {},
      disabled: node.disabled === true,
    })),
    connections: edges.map((edge) => ({
      fromNodeId: edge.source,
      toNodeId: edge.target,
      ...resolveEdgePorts(edge, typeOfNode),
    })),
  };
}
