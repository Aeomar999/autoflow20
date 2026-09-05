import toposort from "toposort";
import {
  EXPRESSION_HELPERS,
  getTemplateRoots,
} from "@/features/executions/template";
import { findModelForCandidate } from "@/lib/ai/registry";
import { MAX_WAIT_SECONDS } from "@/nodes/core/wait/definition";
import { outputPorts } from "@/nodes/ports";
import { RUN_POLICY_KEY, runPolicySchema } from "@/nodes/shared/run-policy";

/**
 * Fan-out segment node type ids (AF-M9-14, ADR-0021). These are permanent,
 * stable type strings persisted in `Node.type` — never rename. SPLIT_OUT opens
 * a bounded fan-out segment, AGGREGATE closes it.
 */
export const SPLIT_OUT_TYPE = "SPLIT_OUT";
export const AGGREGATE_TYPE = "AGGREGATE";

const FAN_OUT_BOUNDARY_TYPES: ReadonlySet<string> = new Set([
  SPLIT_OUT_TYPE,
  AGGREGATE_TYPE,
]);

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
  checkSegments(nodes, connections, errors);
  checkRespondNodes(nodes, connections, errors);
  checkWaitBounds(nodes, errors);
  checkVisionCapability(nodes, errors);

  // --- Registry-dependent checks (server only) ---

  if (registry) {
    checkUnknownTypes(nodes, registry, errors);
    checkConfigs(nodes, registry, errors);
    checkOrphanedEdges(nodes, connections, registry, errors);
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

/** Node type of the AF-M9-10 respond node, matched structurally. */
const RESPOND_NODE_TYPE = "RESPOND_TO_WEBHOOK";

/**
 * Warn about respond nodes that cannot do what their author expects
 * (AF-M9-10).
 *
 * Two shapes, both warnings rather than errors: each produces a workflow that
 * runs correctly and simply does not respond the way it looks like it will, so
 * blocking a save would be heavy-handed — and a half-built graph passes
 * through both states on the way to a finished one.
 *
 *  1. **No webhook trigger.** A composed response is only ever read by the
 *     synchronous webhook route. In a schedule- or manual-triggered workflow
 *     the node runs, writes `Execution.response`, and nobody ever reads it.
 *
 *  2. **Two respond nodes on one path.** The engine takes last-writer-wins, so
 *     the second silently overwrites the first. Respond nodes on *different*
 *     branches are fine and common (the whole point of W1's router shape), so
 *     the check is ancestry, not a count.
 */
function checkRespondNodes(
  nodes: GraphNode[],
  connections: GraphConnection[],
  errors: ValidationError[],
): void {
  const respondNodes = nodes.filter(
    (n) => n.type === RESPOND_NODE_TYPE && !n.disabled,
  );
  if (respondNodes.length === 0) return;

  const hasWebhookTrigger = nodes.some(
    (n) => n.type === "WEBHOOK_TRIGGER" && !n.disabled,
  );
  if (!hasWebhookTrigger) {
    for (const node of respondNodes) {
      errors.push({
        nodeId: node.id,
        severity: "warning",
        message: `"${node.name}" responds to a webhook, but this workflow has no enabled webhook trigger. The response will be composed and stored, but nothing will read it.`,
      });
    }
  }

  if (respondNodes.length < 2) return;

  // Forward adjacency, built once and shared by every reachability walk.
  const outgoing = new Map<string, string[]>();
  for (const c of connections) {
    const targets = outgoing.get(c.fromNodeId);
    if (targets) {
      targets.push(c.toNodeId);
    } else {
      outgoing.set(c.fromNodeId, [c.toNodeId]);
    }
  }

  const respondIds = new Set(respondNodes.map((n) => n.id));

  for (const start of respondNodes) {
    // BFS from this respond node. `seen` also guards against a cycle, which
    // `checkCycles` reports separately — this check must not hang on one.
    const seen = new Set<string>([start.id]);
    const queue = [...(outgoing.get(start.id) ?? [])];

    while (queue.length > 0) {
      const current = queue.shift() as string;
      if (seen.has(current)) continue;
      seen.add(current);

      if (respondIds.has(current)) {
        const downstream = nodes.find((n) => n.id === current);
        errors.push({
          nodeId: current,
          severity: "warning",
          message: `"${downstream?.name ?? current}" is downstream of another Respond to Webhook node ("${start.name}"). Only the last response to run is returned; the earlier one is overwritten.`,
        });
        // Do not walk past it: anything further downstream is that node's
        // problem to report, not a second complaint about this pair.
        continue;
      }

      queue.push(...(outgoing.get(current) ?? []));
    }
  }
}

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
  } else if (triggers[0].disabled) {
    // AF-M9-17: a workflow whose ONLY trigger is disabled cannot fire — a
    // webhook POST and a cron tick both skip a disabled trigger before any
    // execution is created, and a manual run refuses up front. Warn on the
    // canvas (and at save) so it is visible before the trigger is published,
    // not discovered by silence. Warning severity: never blocks saving, matches
    // the informational posture of the other unreachable-node warnings.
    errors.push({
      nodeId: triggers[0].id,
      severity: "warning",
      message: `Workflow's only trigger "${triggers[0].name}" is disabled. No events will start this workflow until it is enabled.`,
    });
  }
}

/**
 * A `WAIT` may not exceed the platform's maximum (AF-M10-08).
 *
 * Enforced at SAVE time, as an error, because the alternative is finding out
 * mid-run: a workflow that fails three days into a six-day wait has already
 * burned three days, and the author is not watching. The `until` mode cannot
 * be checked here — its target is computed at run time — so the executor
 * carries the same ceiling and fails before sleeping.
 */
function checkWaitBounds(nodes: GraphNode[], errors: ValidationError[]): void {
  for (const node of nodes) {
    if (node.type !== "WAIT") continue;

    const data = (node.data ?? {}) as {
      mode?: unknown;
      seconds?: unknown;
    };
    const mode = data.mode === "until" ? "until" : "duration";
    if (mode !== "duration") continue;

    const seconds = typeof data.seconds === "number" ? data.seconds : undefined;
    if (seconds === undefined) continue;

    if (seconds > MAX_WAIT_SECONDS) {
      errors.push({
        nodeId: node.id,
        severity: "error",
        message: `Wait "${node.name}" is set to ${Math.round(seconds / 86_400)} days, beyond the ${MAX_WAIT_SECONDS / 86_400}-day maximum. Shorten the wait, or split the workflow.`,
      });
    }
  }
}

/**
 * A node with attachments must use models that can see (AF-M10-07).
 *
 * At SAVE time, as an error, because the run-time alternative is a model that
 * silently ignores the image and answers anyway — a confident summary of an
 * invoice it never saw. That failure has no symptom until someone checks the
 * numbers.
 *
 * Every model in the chain is checked, not just the primary: a fallback that
 * cannot see would produce exactly that answer on the day the primary is down.
 */
function checkVisionCapability(
  nodes: GraphNode[],
  errors: ValidationError[],
): void {
  for (const node of nodes) {
    if (node.type !== "AI_LLM" && node.type !== "AI_EXTRACT") continue;

    const data = (node.data ?? {}) as {
      attachments?: unknown;
      model?: unknown;
      fallbackModels?: unknown;
    };
    if (
      typeof data.attachments !== "string" ||
      data.attachments.trim().length === 0
    ) {
      continue;
    }

    const candidates = [
      typeof data.model === "string" ? data.model : "",
      ...(typeof data.fallbackModels === "string"
        ? data.fallbackModels.split(/[,;\n]+/)
        : []),
    ]
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

    for (const candidate of candidates) {
      const model = findModelForCandidate(candidate);
      // An unresolvable model is `checkConfigs`' problem to report; naming it
      // twice, differently, helps nobody.
      if (!model) continue;

      if (!model.capabilities.includes("vision")) {
        errors.push({
          nodeId: node.id,
          severity: "error",
          message: `"${node.name}" has an attachment, but model "${candidate}" does not support the "vision" capability and cannot read it. Choose a vision-capable model, or remove the attachment.`,
        });
      }
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

/**
 * (AF-M9-09) Reject a connection whose source output port no longer exists on
 * its source node's resolved ports.
 *
 * This is the guard against silently detaching edges. Renaming a SWITCH rule's
 * `outputKey` removes that port; without this check the edge would simply match
 * nothing at run time and the user would never be told. Each offending edge is
 * reported with its source node and the (now orphaned) port so the user can
 * re-point or delete it.
 *
 * Resolution goes through the SAME shared helper the engine and editor use —
 * `outputPorts(type, node.data)` — so a port that is legal on the canvas is
 * legal at run time. Unknown types are already flagged by
 * `checkUnknownTypes`, so their edges are skipped here to avoid a noisy
 * duplicate. Unreachable/disconnected nodes are reported separately by
 * `checkDisconnected`.
 */
function checkOrphanedEdges(
  nodes: GraphNode[],
  connections: GraphConnection[],
  registry: ValidationRegistry,
  errors: ValidationError[],
): void {
  for (const node of nodes) {
    if (!registry.has(node.type)) continue;

    const outgoing = connections.filter((c) => c.fromNodeId === node.id);
    if (outgoing.length === 0) continue;

    const ids = new Set(outputPorts(node.type, node.data).map((p) => p.id));

    for (const conn of outgoing) {
      if (ids.has(conn.fromOutput)) continue;
      errors.push({
        nodeId: node.id,
        path: `outputs.${conn.fromOutput}`,
        severity: "error",
        message: `Output port "${conn.fromOutput}" no longer exists on this ${node.type} node. The edge to "${conn.toNodeId}" would be silently detached — rename the rule's output key back, or delete the edge.`,
      });
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
// Fan-out segment shape (AF-M9-14, ADR-0021)
// ---------------------------------------------------------------------------

/** All nodes reachable from `start` following directed edges. */
function reachableFrom(
  start: string,
  nodes: GraphNode[],
  connections: GraphConnection[],
): Set<string> {
  const out = new Set<string>([start]);
  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n.id, []);
  for (const c of connections) {
    const list = adj.get(c.fromNodeId);
    if (list) list.push(c.toNodeId);
  }
  const queue = [start];
  let head = 0;
  while (head < queue.length) {
    for (const next of adj.get(queue[head]) ?? []) {
      if (!out.has(next)) {
        out.add(next);
        queue.push(next);
      }
    }
    head++;
  }
  return out;
}

/**
 * Validate fan-out segment shape (AF-M9-14, ADR-0021). All checks are
 * "error" severity: a malformed segment must block the run, never silently
 * mis-execute or partially deliver the W3 batch.
 *
 * Rules enforced:
 *  1. Pairing — every SPLIT_OUT must reach exactly one AGGREGATE that reaches
 *     it back, and vice versa (1:1, symmetric).
 *  2. No nesting — no SPLIT_OUT/AGGREGATE may sit strictly between another
 *     pair.
 *  3. No crossing — the only legal edges touching a segment are SPLIT_OUT →
 *     first interior node, interior→interior, and last interior → AGGREGATE
 *     (plus SPLIT_OUT → AGGREGATE for an empty interior). Any other edge that
 *     enters or leaves the interior is an error.
 *
 * "interior(S, A)" = nodes (excluding S and A) reachable from S that also
 * reach A.
 */
function checkSegments(
  nodes: GraphNode[],
  connections: GraphConnection[],
  errors: ValidationError[],
): void {
  if (nodes.length === 0) return;

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const splits = nodes.filter((n) => n.type === SPLIT_OUT_TYPE);
  const aggregates = nodes.filter((n) => n.type === AGGREGATE_TYPE);
  if (splits.length === 0 && aggregates.length === 0) return;

  // --- 1. Pairing via mutual reachability -----------------------------
  const splitToAgg = new Map<string, string[]>();
  const aggToSplit = new Map<string, string[]>();

  for (const s of splits) {
    const fwd = reachableFrom(s.id, nodes, connections);
    const aggs = aggregates.filter((a) => fwd.has(a.id));
    splitToAgg.set(
      s.id,
      aggs.map((a) => a.id),
    );
  }
  for (const a of aggregates) {
    // Invert the split→aggregate reachability above: an AGGREGATE is paired
    // with every SPLIT_OUT whose forward reachability includes it. Mutual
    // reachability (paired below) keeps the pairing symmetric and unique.
    aggToSplit.set(
      a.id,
      splits
        .filter((s) => (splitToAgg.get(s.id) ?? []).includes(a.id))
        .map((s) => s.id),
    );
  }

  for (const s of splits) {
    const paired = splitToAgg.get(s.id) ?? [];
    if (paired.length === 0) {
      errors.push({
        nodeId: s.id,
        severity: "error",
        message: `${SPLIT_OUT_TYPE} "${s.name}" has no closing ${AGGREGATE_TYPE} node. Add an AGGREGATE to close its fan-out segment, or remove the SPLIT_OUT.`,
      });
    } else if (paired.length > 1) {
      errors.push({
        nodeId: s.id,
        severity: "error",
        message: `${SPLIT_OUT_TYPE} "${s.name}" reaches ${paired.length} ${AGGREGATE_TYPE} nodes. A fan-out segment must close with exactly one AGGREGATE.`,
      });
    }
  }
  for (const a of aggregates) {
    const paired = aggToSplit.get(a.id) ?? [];
    if (paired.length === 0) {
      errors.push({
        nodeId: a.id,
        severity: "error",
        message: `${AGGREGATE_TYPE} "${a.name}" has no opening ${SPLIT_OUT_TYPE} node. Add a SPLIT_OUT to open its fan-out segment, or remove the AGGREGATE.`,
      });
    } else if (paired.length > 1) {
      errors.push({
        nodeId: a.id,
        severity: "error",
        message: `${AGGREGATE_TYPE} "${a.name}" is reached by ${paired.length} ${SPLIT_OUT_TYPE} nodes. A fan-out segment must open with exactly one SPLIT_OUT.`,
      });
    }
  }

  // --- 2/3. Per valid pair, check nesting + crossing ------------------
  // A pair is "candidate" when both sides exist and are uniquely paired; we
  // still run structural checks once per (s, a) edge reachable, guarded to
  // avoid duplicate errors when pairing already failed.
  const pairedPairs: Array<[string, string]> = [];
  for (const s of splits) {
    const aggs = splitToAgg.get(s.id) ?? [];
    for (const aId of aggs) {
      const back = aggToSplit.get(aId) ?? [];
      if (back.includes(s.id)) {
        pairedPairs.push([s.id, aId]);
      }
    }
  }
  // Deduplicate reverse-duplicated pairs.
  const seenPairs = new Set<string>();
  const uniquePairs: Array<[string, string]> = [];
  for (const [s, a] of pairedPairs) {
    const key = `${s}|${a}`;
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    uniquePairs.push([s, a]);
  }
  if (uniquePairs.length === 0) return;

  for (const [sId, aId] of uniquePairs) {
    const interior = new Set<string>();
    const sReach = reachableFrom(sId, nodes, connections);
    const parents = parentMap(nodes, connections);
    for (const n of nodes) {
      if (n.id === sId || n.id === aId) continue;
      if (!sReach.has(n.id)) continue;
      if (reachesTarget(n.id, aId, parents)) {
        interior.add(n.id);
      }
    }

    const sNode = byId.get(sId);
    const aNode = byId.get(aId);

    // Nesting: any other boundary node inside the interior.
    for (const insideId of interior) {
      const insideType = byId.get(insideId)?.type;
      if (FAN_OUT_BOUNDARY_TYPES.has(insideType ?? "")) {
        errors.push({
          nodeId: insideId,
          severity: "error",
          message: `Nested fan-out: nodes between "${sNode?.name}" and "${aNode?.name}" contain another ${insideType}. Segments cannot be nested — flatten it.`,
        });
      }
    }

    // Crossing: edges involving an interior node (or the split/aggregate)
    // that leave the segment envelope {interior ∪ {S, A}}.
    const envelope = new Set<string>([...interior, sId, aId]);
    const interiorOnly = interior; // excludes S and A

    for (const c of connections) {
      const crosses =
        (interiorOnly.has(c.fromNodeId) && !envelope.has(c.toNodeId)) ||
        (interiorOnly.has(c.toNodeId) && !envelope.has(c.fromNodeId));
      if (crosses) {
        const fromName = byId.get(c.fromNodeId)?.name ?? c.fromNodeId;
        const toName = byId.get(c.toNodeId)?.name ?? c.toNodeId;
        errors.push({
          nodeId: interiorOnly.has(c.fromNodeId) ? c.fromNodeId : c.toNodeId,
          severity: "error",
          message: `Crossing edge in fan-out segment: "${fromName}" → "${toName}" connects a segment interior node to a node outside the segment. The interior of a SPLIT_OUT/AGGREGATE segment cannot connect to nodes outside it.`,
        });
      }
    }
  }
}

function parentMap(
  nodes: GraphNode[],
  connections: GraphConnection[],
): Map<string, string[]> {
  const parents = new Map<string, string[]>();
  for (const n of nodes) parents.set(n.id, []);
  for (const c of connections) {
    parents.get(c.toNodeId)?.push(c.fromNodeId);
  }
  return parents;
}

/** True when `target` is reachable from `start` via reverse-BFS on parents. */
function reachesTarget(
  start: string,
  target: string,
  parents: Map<string, string[]>,
): boolean {
  const seen = new Set<string>([target]);
  const queue = [target];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    if (current === start) return true;
    for (const parent of parents.get(current) ?? []) {
      if (!seen.has(parent)) {
        seen.add(parent);
        queue.push(parent);
      }
    }
  }
  return seen.has(start);
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
  // Fan-out segment scope (AF-M9-14): $item / $itemIndex exist for every
  // interior node of a segment; always-present so a valid in-segment
  // reference is never flagged as an unknown root.
  "$item",
  "$itemIndex",
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
 *
 * AF-M10-14: `FORM_TRIGGER` seeds `form`, holding `{ nodeId, title,
 * submittedAt, fields, files }` — deliberately nested under one root for the
 * same reason `webhook` is, so a field named `title` cannot shadow the form's
 * own metadata. AF-M10-05: a polling trigger seeds `trigger` alongside the
 * item's own payload, which is spread flat because the shape is the provider's.
 */
const TRIGGER_CONTEXT_ROOTS: Record<string, readonly string[]> = {
  WEBHOOK_TRIGGER: ["webhook"],
  MANUAL_TRIGGER: ["trigger"],
  INITIAL: ["trigger"],
  SCHEDULE_TRIGGER: ["schedule"],
  GOOGLE_FORM_TRIGGER: ["googleForm"],
  STRIPE_TRIGGER: ["stripe"],
  FORM_TRIGGER: ["form"],
  /**
   * Polling triggers (AF-M10-05) seed `trigger` — which the sweep always adds,
   * carrying `nodeId`/`itemId`/`polledAt` — plus whatever the poller's item
   * data spreads flat. The spread is per-connector, so each polling trigger
   * names its own roots here rather than the sweep guessing them.
   */
  SHEETS_TRIGGER: ["trigger", "row", "sheet"],
  GMAIL_TRIGGER: ["trigger", "message"],
  DRIVE_TRIGGER: ["trigger", "file"],
  CALENDAR_TRIGGER: ["trigger", "event"],
  QBO_WEBHOOK_TRIGGER: ["trigger", "qbo"],
  GITHUB_TRIGGER: ["github"],
  AIRTABLE_TRIGGER: ["record", "table"],
  TELEGRAM_TRIGGER: ["telegram"],
  WAHA_TRIGGER: ["whatsapp"],
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
 * Top-level context keys a `CODE` node contributes (AF-M10-17).
 *
 * The executor spreads a returned object flat onto the context and stores a
 * returned array as `items`. Neither is declared anywhere — the keys are
 * whatever the JavaScript returns — so without this a completely ordinary
 * graph (`CODE` returning `{ valid, errors }`, a `CONDITION` reading
 * `{{valid}}`) was reported as referencing an unknown root. That is a false
 * positive on a pattern the automation library uses repeatedly, and false
 * positives are how a validator gets ignored.
 *
 * A literal `return { ... }` is statically readable, which is what an authored
 * template writes. `items` is always added because the array branch needs no
 * analysis. When the body returns something this cannot read — `return rows`,
 * a conditional return — `null` is returned to say "unknowable", and the
 * caller stops root-checking rather than inventing warnings it cannot stand
 * behind.
 */
function codeReturnRoots(node: GraphNode): string[] | null {
  if (node.type !== "CODE") return [];
  const code = node.data?.code;
  if (typeof code !== "string" || code.trim() === "") return [];

  const roots = new Set<string>(["items"]);
  let sawObjectReturn = false;

  // One string- and comment-aware pass over the source. Blanking strings first
  // would be simpler, but it erases QUOTED KEYS: `{ "delta": 4 }` becomes
  // `{ "": 4 }`, the root goes unrecorded, and every reference to it is then
  // reported as a typo — the exact false positive this function exists to
  // prevent.
  let i = 0;
  while (i < code.length) {
    const ch = code[i];

    if (ch === "/" && code[i + 1] === "/") {
      while (i < code.length && code[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && code[i + 1] === "*") {
      i += 2;
      while (i < code.length && !(code[i] === "*" && code[i + 1] === "/")) {
        i += 1;
      }
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      i = skipString(code, i);
      continue;
    }

    if (
      code.startsWith("return", i) &&
      !/[\w$]/.test(code[i - 1] ?? "") &&
      !/[\w$]/.test(code[i + 6] ?? "")
    ) {
      let j = i + 6;
      while (j < code.length && /\s/.test(code[j])) j += 1;

      // An array return is stored under `items`, already allowed above.
      if (code[j] === "[") {
        i = j + 1;
        continue;
      }
      // `return someVariable`, `return cond ? a : b` — unknowable.
      if (code[j] !== "{") return null;

      const entries = topLevelEntries(code, j);
      if (entries === null) return null;
      for (const entry of entries) {
        const name = leadingKey(entry);
        if (name) roots.add(name);
      }
      sawObjectReturn = true;
      i = j + 1;
      continue;
    }

    i += 1;
  }

  // No return at all: the node contributes nothing, which is not the same as
  // "unknowable".
  return sawObjectReturn ? [...roots] : [];
}

/** Index just past the string literal starting at `start`. */
function skipString(code: string, start: number): number {
  const quote = code[start];
  let i = start + 1;
  while (i < code.length && code[i] !== quote) {
    if (code[i] === "\\") i += 1;
    i += 1;
  }
  return i + 1;
}

/**
 * Split an object literal's top-level entries, starting at its `{`.
 *
 * Depth and string state are tracked together so a comma inside a nested
 * object, an array, a call, or a string does not split an entry. Returns null
 * if the literal never closes, which means this is not something to reason
 * about statically.
 */
function topLevelEntries(code: string, open: number): string[] | null {
  const entries: string[] = [];
  let entry = "";
  let depth = 0;
  let i = open;

  while (i < code.length) {
    const ch = code[i];

    // Comments inside the literal are dropped, not accumulated. A commented
    // line between two properties is ordinary in authored code, and treating
    // it as part of the following entry hides that entry's key — which then
    // reads as an unknown root at every reference to it.
    if (ch === "/" && code[i + 1] === "/") {
      while (i < code.length && code[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && code[i + 1] === "*") {
      i += 2;
      while (i < code.length && !(code[i] === "*" && code[i + 1] === "/")) {
        i += 1;
      }
      i += 2;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      const end = skipString(code, i);
      entry += code.slice(i, end);
      i = end;
      continue;
    }

    if (ch === "{" || ch === "[" || ch === "(") {
      depth += 1;
      if (depth > 1) entry += ch;
      i += 1;
      continue;
    }

    if (ch === "}" || ch === "]" || ch === ")") {
      depth -= 1;
      if (depth === 0) {
        entries.push(entry);
        return entries;
      }
      entry += ch;
      i += 1;
      continue;
    }

    if (ch === "," && depth === 1) {
      entries.push(entry);
      entry = "";
      i += 1;
      continue;
    }

    entry += ch;
    i += 1;
  }

  return null;
}

/** The key an object-literal entry declares: `key:`, `"key":`, or shorthand. */
function leadingKey(entry: string): string | undefined {
  const match = entry
    .trim()
    .match(
      /^(?:"([A-Za-z_$][\w$]*)"|'([A-Za-z_$][\w$]*)'|([A-Za-z_$][\w$]*))\s*(?::|$)/,
    );
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

/**
 * The set of top-level roots the graph, as a whole, can place in the template
 * context: always-present meta keys, every data node's `variableName`, every
 * SET node mapping key (first dot segment), and the trigger's seeded keys.
 * Forward references are permitted only when some node actually produces that
 * root — a reference to a root nobody produces is the porting bug we catch.
 */
function computeValidRoots(nodes: GraphNode[]): Set<string> | null {
  const valid = new Set<string>([
    ...ALWAYS_PRESENT_ROOTS,
    ...EXPRESSION_HELPERS,
  ]);
  for (const node of nodes) {
    const codeRoots = codeReturnRoots(node);
    // One unreadable CODE body makes the whole set unknowable: any root it
    // produces would otherwise be reported as a typo.
    if (codeRoots === null) return null;
    for (const root of codeRoots) valid.add(root);
    const triggerRoots = TRIGGER_CONTEXT_ROOTS[node.type];
    if (triggerRoots) {
      for (const root of triggerRoots) valid.add(root);
    }
    const data = node.data ?? {};
    if (typeof data.variableName === "string" && data.variableName !== "") {
      valid.add(data.variableName);
    }
    for (const root of spreadPayloadRoots(node)) valid.add(root);
    // AF-M10-34: a closed fan-out segment replaces the rolling context with
    // its collected result — `context = aggregateResult` in the engine — so
    // everything after an AGGREGATE really can read `items`, `count` and
    // `failed`. The node carries no `variableName` (its config schema is
    // empty), so nothing above adds them, and the validator was reporting a
    // correct template as referencing an unknown root. It was hidden until
    // now because the one template that does this had malformed braces, so
    // the reference never parsed far enough to be checked.
    if (node.type === AGGREGATE_TYPE) {
      valid.add("items");
      valid.add("count");
      valid.add("failed");
    }
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
  // A CODE node whose return this cannot read makes every root unknowable
  // (AF-M10-17). Warning about roots we cannot enumerate would flag correct
  // graphs, and a validator that cries wolf gets switched off.
  if (valid === null) return;

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
