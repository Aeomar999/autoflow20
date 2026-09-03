import toposort from "toposort";
import { RUN_POLICY_KEY, runPolicySchema } from "@/nodes/shared/run-policy";

/**
 * Shared graph validator (AF-M2-02). One implementation, three call sites:
 *   1. Canvas linting (AF-M1-07) — client-side with the catalogue adapter
 *      (`src/features/editor/lib/validation.ts`)
 *   2. Save boundary (routers.ts) — server-side with the full registry
 *   3. Engine (functions.ts) — server-side with the full registry, before run
 *
 * Isomorphic: no Prisma, no server-only imports. Deterministic output for
 * identical graphs (stable tie-breaking by node id).
 */

/**
 * Structural view of a node registry that `validate` needs. Kept deliberately
 * minimal so it accepts both the server `NodeRegistry` (`src/nodes/registry.ts`)
 * and the client-side catalogue adapter (`src/features/editor/lib/validation.ts`)
 * without pulling Prisma or zod into the graph.
 */
export interface ValidationRegistry {
  has(type: string): boolean;
  resolve(type: string): {
    configSchema: {
      safeParse(data: unknown): {
        success: boolean;
        error?: {
          issues: Array<{ path: unknown[]; message: string }>;
        };
      };
    };
    inputs: Array<{ id: string; required?: boolean }>;
  };
}

export type ValidationError = {
  /** Node that caused the error (omitted for graph-level errors). */
  nodeId?: string;
  /** Field path within the node (e.g. "data.endpoint"). */
  path?: string;
  /** Human-readable error message. */
  message: string;
  /** Severity: "error" blocks execution; "warning" is informational. */
  severity: "error" | "warning";
};

export type GraphNode = {
  id: string;
  name: string;
  type: string;
  data: Record<string, unknown>;
  /**
   * Persisted `Node.disabled` (AF-M9-04). A disabled node is traced `SKIPPED`
   * and passes its input through; it never executes, so its config and its
   * required inputs cannot fail a run and are exempt from validation.
   */
  disabled?: boolean;
};

export type GraphConnection = {
  fromNodeId: string;
  toNodeId: string;
  fromOutput: string;
  toInput: string;
};

export type Graph = {
  nodes: GraphNode[];
  connections: GraphConnection[];
};

export type ValidationResult = {
  errors: ValidationError[];
  /**
   * Deterministic topological order (node IDs). Only meaningful when
   * there are no cycle errors — for cyclic graphs this is empty.
   */
  order: string[];
};

/**
 * Validate a workflow graph and produce a deterministic execution order.
 *
 * @param graph - The workflow graph to validate.
 * @param registry - Registry of node definitions for type and config checks
 *                   (server `NodeRegistry` or the client catalogue adapter).
 *                   Omit to skip unknown-type and config-schema validation.
 */
export function validate(
  graph: Graph,
  registry?: ValidationRegistry,
): ValidationResult {
  const errors: ValidationError[] = [];
  const { nodes, connections } = graph;

  // --- Structural checks (always run) ---

  checkCycles(nodes, connections, errors);
  checkTriggers(nodes, errors);
  checkRequiredInputs(nodes, connections, registry, errors);
  checkDisconnected(nodes, connections, errors);

  // --- Registry-dependent checks (server only) ---

  if (registry) {
    checkUnknownTypes(nodes, registry, errors);
    checkConfigs(nodes, registry, errors);
  }

  // --- Deterministic order (only if no cycles) ---

  const hasCycles = errors.some(
    (e) => e.severity === "error" && e.message.includes("cycle"),
  );
  const order = hasCycles ? [] : computeOrder(nodes, connections);

  return { errors, order };
}

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

function checkTriggers(nodes: GraphNode[], errors: ValidationError[]): void {
  if (nodes.length === 0) return;

  const triggers = nodes.filter((n) => {
    // A node is a trigger if its type ends with _TRIGGER or its registry
    // definition has category TRIGGER. Without the registry we fall back to
    // the naming convention which covers all current trigger types.
    return n.type.endsWith("_TRIGGER");
  });

  if (triggers.length === 0) {
    errors.push({
      severity: "error",
      message:
        "Workflow has no trigger node. Add a trigger to define when the workflow runs.",
    });
  } else if (triggers.length > 1) {
    for (const t of triggers) {
      errors.push({
        nodeId: t.id,
        severity: "error",
        message: `Multiple trigger nodes found. Only one trigger is allowed per workflow.`,
      });
    }
  }
}

function checkCycles(
  nodes: GraphNode[],
  connections: GraphConnection[],
  errors: ValidationError[],
): void {
  if (connections.length === 0 || nodes.length <= 1) return;

  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges: [string, string][] = connections
    .filter((c) => nodeIds.has(c.fromNodeId) && nodeIds.has(c.toNodeId))
    .map((c) => [c.fromNodeId, c.toNodeId]);

  try {
    toposort(edges);
  } catch {
    errors.push({
      severity: "error",
      message:
        "Workflow contains a cycle. Cycles prevent execution — add a Wait or Loop node to break them.",
    });
  }
}

function checkUnknownTypes(
  nodes: GraphNode[],
  registry: ValidationRegistry,
  errors: ValidationError[],
): void {
  for (const node of nodes) {
    if (!registry.has(node.type)) {
      errors.push({
        nodeId: node.id,
        severity: "error",
        message: `Unknown node type: "${node.type}".`,
      });
    }
  }
}

function checkConfigs(
  nodes: GraphNode[],
  registry: ValidationRegistry,
  errors: ValidationError[],
): void {
  for (const node of nodes) {
    // AF-M9-04: a disabled node never executes, so a half-finished config on
    // one must not block saving or running the rest of the workflow — turning
    // a node off is the normal way to park work in progress.
    if (node.disabled) continue;

    // AF-M9-06: the run policy lives under a reserved key alongside the node's
    // own config, not inside its `configSchema`. Validating it separately is
    // deliberate — `configSchema` is also what drives the config form, and
    // merging an object field into every node's schema would either break the
    // form's introspection or require excluding the key again on the way out.
    // Same error channel, so a bad retry count surfaces exactly where a bad
    // endpoint does.
    const rawPolicy = node.data?.[RUN_POLICY_KEY];
    if (rawPolicy !== undefined && rawPolicy !== null) {
      const policyResult = runPolicySchema.safeParse(rawPolicy);
      if (!policyResult.success) {
        for (const issue of policyResult.error.issues) {
          errors.push({
            nodeId: node.id,
            path: [RUN_POLICY_KEY, ...issue.path].join("."),
            severity: "error",
            message: `Run settings: ${issue.message}`,
          });
        }
      }
    }

    try {
      const registration = registry.resolve(node.type);
      const result = registration.configSchema.safeParse(node.data);
      if (!result.success) {
        for (const issue of result.error?.issues ?? []) {
          errors.push({
            nodeId: node.id,
            path: issue.path.join("."),
            severity: "error",
            message: `Config error: ${issue.message}`,
          });
        }
      }
    } catch {
      // Unknown type — already reported by checkUnknownTypes.
    }
  }
}

function checkRequiredInputs(
  nodes: GraphNode[],
  connections: GraphConnection[],
  registry: ValidationRegistry | undefined,
  errors: ValidationError[],
): void {
  // Build a set of (nodeId, inputPort) pairs that have incoming connections.
  const connected = new Set<string>();
  for (const conn of connections) {
    connected.add(`${conn.toNodeId}:${conn.toInput}`);
  }

  for (const node of nodes) {
    // AF-M9-04: same reasoning as checkConfigs — a disabled node's unconnected
    // required input cannot fail a run it does not take part in.
    if (node.disabled) continue;

    let requiredPorts: string[] = [];

    if (registry) {
      try {
        const registration = registry.resolve(node.type);
        requiredPorts = registration.inputs
          .filter((p) => p.required)
          .map((p) => p.id);
      } catch {
        // Unknown type — skip.
        continue;
      }
    }

    for (const portId of requiredPorts) {
      if (!connected.has(`${node.id}:${portId}`)) {
        errors.push({
          nodeId: node.id,
          path: `inputs.${portId}`,
          severity: "error",
          message: `Required input "${portId}" is not connected.`,
        });
      }
    }
  }
}

function checkDisconnected(
  nodes: GraphNode[],
  connections: GraphConnection[],
  errors: ValidationError[],
): void {
  if (nodes.length <= 1) return;

  const nodeIds = new Set(nodes.map((n) => n.id));

  // Build adjacency: from → [to]
  const adj = new Map<string, Set<string>>();
  for (const id of nodeIds) adj.set(id, new Set());
  for (const conn of connections) {
    if (nodeIds.has(conn.fromNodeId) && nodeIds.has(conn.toNodeId)) {
      adj.get(conn.fromNodeId)?.add(conn.toNodeId);
    }
  }

  // BFS from every trigger to find reachable nodes.
  const reachable = new Set<string>();
  const triggers = nodes.filter((n) => n.type.endsWith("_TRIGGER"));

  for (const trigger of triggers) {
    const queue = [trigger.id];
    reachable.add(trigger.id);
    while (queue.length > 0) {
      const current = queue[0];
      queue.shift();
      for (const neighbor of adj.get(current) ?? []) {
        if (!reachable.has(neighbor)) {
          reachable.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
  }

  // Report unreachable nodes as warnings.
  for (const node of nodes) {
    if (!reachable.has(node.id) && !node.type.endsWith("_TRIGGER")) {
      errors.push({
        nodeId: node.id,
        severity: "warning",
        message: `Node "${node.name}" is not reachable from any trigger.`,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Deterministic ordering
// ---------------------------------------------------------------------------

function computeOrder(
  nodes: GraphNode[],
  connections: GraphConnection[],
): string[] {
  if (nodes.length === 0) return [];
  if (connections.length === 0) {
    // No edges — return nodes sorted alphabetically by id for stability.
    return [...nodes].sort((a, b) => a.id.localeCompare(b.id)).map((n) => n.id);
  }

  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges: [string, string][] = connections
    .filter((c) => nodeIds.has(c.fromNodeId) && nodeIds.has(c.toNodeId))
    .map((c) => [c.fromNodeId, c.toNodeId]);

  let sorted: string[];
  try {
    sorted = toposort(edges);
  } catch {
    // Cyclic — return empty. Caller should check errors first.
    return [];
  }

  // Deduplicate (toposort can include duplicates with diamond graphs).
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of sorted) {
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }

  // Append nodes that never appeared in edges (isolated nodes).
  // Sort alphabetically for deterministic output.
  const isolated = nodes
    .filter((n) => !seen.has(n.id))
    .sort((a, b) => a.id.localeCompare(b.id));
  for (const node of isolated) {
    result.push(node.id);
  }

  return result;
}
