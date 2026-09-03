import toposort from "toposort";
import {
  EXPRESSION_HELPERS,
  getTemplateRoots,
} from "@/features/executions/template";
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

  // --- Template root inference (AF-M9-07) ---
  // Warn when a config template references a top-level root the graph cannot
  // produce, so a ported (n8n) expression fails loudly instead of silently
  // rendering as "". Runs on both server save and client lint because the
  // valid-root set is derived purely from graph structure.
  checkTemplateRoots(nodes, errors);

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
// Template root inference (AF-M9-07)
// ---------------------------------------------------------------------------

/**
 * Top-level context keys that always exist in any template context regardless
 * of the graph (`buildTemplateContext` in `src/features/executions/template.ts`).
 */
const ALWAYS_PRESENT_ROOTS: readonly string[] = [
  "$json",
  "$node",
  "$execution",
  "$workflow",
  "$now",
];

/**
 * Context roots a trigger seeds at the top of the accumulated context, keyed
 * by node type. Webhook exposes a single `webhook` root ─ the n8n→AutoFlow
 * mapping (`$json.body.x` → `{{webhook.body.x}}`) deliberately does NOT expose
 * flat `body`/`query`/`headers`/`params`/`method` top-level keys, so a ported
 * `{{body…}}`/`{{$json.body…}}` expression is caught as an unknown root rather
 * than silently resolving. Manual/INITIAL expose `trigger`, and their parsed
 * payload is spread flat onto the context — those payload keys are enumerated
 * from the config by `spreadPayloadRoots` below (the same data the executor
 * parses), so any key a graph references from a manual payload validates.
 * Schedule, Google-Form and Stripe seed `schedule` / `googleForm` / `stripe`
 * respectively, matching what `cron.ts` and the google-form/stripe webhooks
 * place into context.
 */
const TRIGGER_CONTEXT_ROOTS: Record<string, readonly string[]> = {
  WEBHOOK_TRIGGER: ["webhook"],
  MANUAL_TRIGGER: ["trigger"],
  INITIAL: ["trigger"],
  SCHEDULE_TRIGGER: ["schedule"],
  GOOGLE_FORM_TRIGGER: ["googleForm"],
  STRIPE_TRIGGER: ["stripe"],
};

/** True when value is a template string (contains a Handlebars expression). */
function looksLikeTemplate(value: unknown): value is string {
  return typeof value === "string" && value.includes("{{");
}

/**
 * Recurse through a node's config bag collecting every top-level root
 * referenced by any template string in it.
 */
function collectConfigRoots(
  value: unknown,
  out: Set<string>,
  seen: Set<unknown>,
): void {
  if (value === null || value === undefined || seen.has(value)) return;
  if (typeof value === "object") {
    seen.add(value);
  }
  if (looksLikeTemplate(value)) {
    for (const root of getTemplateRoots(value)) out.add(root);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectConfigRoots(item, out, seen);
    return;
  }
  if (value && typeof value === "object") {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      collectConfigRoots((value as Record<string, unknown>)[key], out, seen);
    }
  }
}

/**
 * Top-level context keys a manual/INITIAL trigger's mock payload contributes.
 *
 * The executor (`src/nodes/core/manual-trigger/execute.ts`) parses the
 * `payload` config string and spreads the resulting object flat onto the
 * context alongside a `trigger` key, so every top-level key of a successfully
 * parsed plain-object payload is a real runtime root. A payload that does not
 * JSON-parse produces no spread keys — matching the executor's `try`/`catch`.
 * Payload keys are therefore statically knowable from the config, so a
 * reference to one must not be flagged as unknown.
 */
function spreadPayloadRoots(node: GraphNode): string[] {
  if (node.type !== "MANUAL_TRIGGER" && node.type !== "INITIAL") {
    return [];
  }
  const payload = node.data?.payload;
  if (typeof payload !== "string" || payload === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return [];
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return [];
  }
  return Object.keys(parsed as Record<string, unknown>);
}

/**
 * The set of top-level roots the graph, as a whole, can place in the template
 * context: always-present meta keys, every data node's `variableName`, every
 * SET node mapping key (first dot segment), and the trigger's seeded keys.
 * Forward references are permitted only when some node actually produces that
 * root — a reference to a root nobody produces is the porting bug we catch.
 */
function computeValidRoots(nodes: GraphNode[]): Set<string> {
  const valid = new Set<string>([
    ...ALWAYS_PRESENT_ROOTS,
    ...EXPRESSION_HELPERS,
  ]);
  for (const node of nodes) {
    const triggerRoots = TRIGGER_CONTEXT_ROOTS[node.type];
    if (triggerRoots) {
      for (const root of triggerRoots) valid.add(root);
    }
    const data = node.data ?? {};
    if (typeof data.variableName === "string" && data.variableName !== "") {
      valid.add(data.variableName);
    }
    for (const root of spreadPayloadRoots(node)) valid.add(root);
    if (node.type === "SET") {
      const mappings = data.mappings;
      if (Array.isArray(mappings)) {
        for (const m of mappings) {
          if (
            m &&
            typeof m === "object" &&
            typeof (m as { key?: unknown }).key === "string"
          ) {
            const key = (m as { key: string }).key;
            valid.add(key.split(".")[0]);
          }
        }
      }
    }
  }
  return valid;
}

function checkTemplateRoots(
  nodes: GraphNode[],
  errors: ValidationError[],
): void {
  if (nodes.length === 0) return;
  const valid = computeValidRoots(nodes);

  for (const node of nodes) {
    // AF-M9-04 parity: a disabled node never executes, so a half-written
    // template on it must not nag at save time.
    if (node.disabled) continue;
    if (!node.data || typeof node.data !== "object") continue;

    const roots = new Set<string>();
    collectConfigRoots(node.data, roots, new Set());
    for (const root of roots) {
      if (valid.has(root)) continue;
      errors.push({
        nodeId: node.id,
        severity: "warning",
        message: `Template references unknown root "${root}". The workflow produces no value under "${root}" — did you mean an existing variable, or one of the trigger keys (e.g. "webhook.body")?`,
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
