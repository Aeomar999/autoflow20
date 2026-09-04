import { createId } from "@paralleldrive/cuid2";

import { nodeRegistry } from "@/nodes/registry";

/**
 * Template graph shapes (AF-M7-01).
 *
 * These deliberately mirror the shapes `saveGraph` persists (React Flow nodes +
 * edges) so a template's `graph` field can be authored directly from a saved
 * workflow. `TemplateNode.data` carries the per-node config WITHOUT credential
 * values — see `prepareTemplateGraph`.
 */
export interface TemplateNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data?: Record<string, unknown>;
  name?: string;
  notes?: string | null;
  disabled?: boolean;
}

export interface TemplateEdge {
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

export interface TemplateGraph {
  nodes: TemplateNode[];
  edges: TemplateEdge[];
}

/** A node field the user must bind to a real credential before running. */
export interface PendingCredential {
  nodeId: string;
  nodeName: string;
  credentialType: string;
  credentialKey: string;
  optional: boolean;
}

/**
 * A config value the installer must supply before the workflow can run
 * (AF-M10-25).
 *
 * Credentials are not the only thing a template cannot ship. A spreadsheet id,
 * a Drive folder, a QuickBooks account or item id, a Slack channel — these are
 * per-installation values, and baking a real one in would either leak the
 * author's workspace or, worse, quietly point somebody's books at a sandbox
 * company that accepts the write and loses it.
 *
 * The catalogue's convention is a literal `REPLACE_WITH_*` placeholder in the
 * config, which was previously visible only to somebody reading the JSON. This
 * makes it visible on the template page and after install, next to the
 * credentials, because both answer the same question: what do I still owe this
 * workflow before it will run?
 */
export interface PendingSetupValue {
  nodeId: string;
  nodeName: string;
  /** Config path, dotted for nesting, e.g. `mappings.0.value`. */
  field: string;
  /** The placeholder token itself, e.g. `REPLACE_WITH_SPREADSHEET_ID`. */
  placeholder: string;
}

/** Output of `prepareTemplateGraph`: a graph rotated to fresh ids. */
export interface PreparedTemplate {
  nodes: TemplateNode[];
  edges: TemplateEdge[];
  idMap: ReadonlyMap<string, string>;
  pendingCredentials: PendingCredential[];
  pendingSetup: PendingSetupValue[];
}

const NODE_REF_PREFIX = "$node.";

/**
 * A `$node.<id>` reference. The id runs to the next `.` (the output-handle
 * separator) or to any other character an id cannot contain, so the capture is
 * always a whole id - never a prefix of a longer one.
 */
const NODE_REF_PATTERN = /\$node\.([A-Za-z0-9_-]+)/g;

/**
 * Rewrite every `$node.<oldId>` reference found anywhere inside a config value
 * (JS template strings in `code`, `{{ }}` expression payloads, nested objects)
 * to the id that `prepareTemplateGraph` assigned to that node.
 */
export function rewriteNodeRefs(
  value: unknown,
  idMap: ReadonlyMap<string, string>,
): unknown {
  if (typeof value === "string") {
    // AF-M8-15: one pass, resolving each token through the map, rather than
    // one `split`/`join` per mapping over the accumulating output. The
    // sequential form had two order-dependent faults: an id it had just
    // written could be matched again by a later mapping (a -> "b1", then
    // b -> "z9", yielding "$node.z91"), and a mapped id that is a prefix of
    // an unmapped one corrupted the longer id ("$node.abc" -> "$node.n1bc").
    // A token here is the whole id up to the reference separator, so it is
    // matched in full or not at all, and a token is only ever visited once.
    return value.replace(NODE_REF_PATTERN, (match, oldId: string) => {
      const newId = idMap.get(oldId);
      return newId === undefined ? match : `${NODE_REF_PREFIX}${newId}`;
    });
  }

  if (Array.isArray(value)) {
    return value.map((entry) => rewriteNodeRefs(entry, idMap));
  }

  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(record)) {
      out[key] = rewriteNodeRefs(entry, idMap);
    }
    return out;
  }

  return value;
}

/**
 * Strip every credential-bound field from a node's config.
 *
 * Deleting (not nulling) is deliberate: node config schemas declare credential
 * refs as `z.string().cuid().optional()`, and `null` fails `safeParse` while
 * `undefined` passes — so a stripped install is valid at the save boundary and
 * the config panel renders the empty credential picker for the user to bind.
 */
function stripCredentialFields(
  data: Record<string, unknown>,
  credentialKeys: string[],
): void {
  for (const key of credentialKeys) {
    delete data[key];
  }
}

/**
 * Fresh instances of a template graph.
 *
 * Every node id is rotated to a new cuid (so two installs of the same template
 * never collide in one workspace), edges are rewired to the new ids, in-data
 * `$node.<oldId>` references are rewritten, and credential-bound data fields
 * are stripped to placeholders. Requires `nodeRegistry` to resolve each node
 * type — an unknown type throws `UnknownNodeTypeError`.
 */
export function prepareTemplateGraph(graph: TemplateGraph): PreparedTemplate {
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    throw new Error("Template graph must have `nodes` and `edges` arrays.");
  }

  const idMap = new Map<string, string>();
  for (const node of graph.nodes) {
    idMap.set(node.id, createId());
  }

  const nodes = graph.nodes.map((node) => {
    const registration = nodeRegistry.resolve(node.type);
    const data =
      node.data !== undefined && node.data !== null
        ? (rewriteNodeRefs(node.data, idMap) as Record<string, unknown>)
        : {};

    stripCredentialFields(
      data,
      (registration.credentials ?? []).map((c) => c.key),
    );

    return {
      id: idMap.get(node.id) as string,
      type: node.type,
      position: node.position,
      data,
      name: node.name,
      notes: node.notes ?? null,
      disabled: node.disabled ?? false,
    };
  });

  const edges = graph.edges.flatMap((edge) => {
    const source = idMap.get(edge.source);
    const target = idMap.get(edge.target);
    if (!source || !target) {
      // Stray edge (node removed from the authored graph): drop it rather
      // than persist a broken connection.
      return [];
    }
    return [
      {
        source,
        target,
        sourceHandle: edge.sourceHandle ?? null,
        targetHandle: edge.targetHandle ?? null,
      },
    ];
  });

  return {
    nodes,
    edges,
    idMap,
    pendingCredentials: collectPendingCredentials(nodes),
    pendingSetup: collectPendingSetup(nodes),
  };
}

/**
 * The `REPLACE_WITH_*` token a template leaves for the installer.
 *
 * Uppercase and underscore-only after the prefix, so it cannot match prose in a
 * prompt or a comment that happens to mention replacing something.
 */
const PENDING_SETUP_PATTERN = /REPLACE_WITH_[A-Z0-9_]+/g;

/**
 * Every setup placeholder in a graph, in node order.
 *
 * The walk is recursive because a placeholder is rarely a top-level string: it
 * appears inside a `mappings` array, inside the JSON body of a `values` field,
 * and inside `code`. Reporting only top-level config keys would have missed
 * most of them and told the installer a template was ready when it was not.
 *
 * A field carrying two placeholders reports twice; the same placeholder used in
 * five nodes reports five times, because the installer has to edit five nodes.
 */
export function collectPendingSetup(
  nodes: TemplateNode[],
): PendingSetupValue[] {
  const pending: PendingSetupValue[] = [];

  const walk = (value: unknown, node: TemplateNode, path: string): void => {
    if (typeof value === "string") {
      for (const match of value.matchAll(PENDING_SETUP_PATTERN)) {
        pending.push({
          nodeId: node.id,
          nodeName: node.name ?? node.type,
          field: path,
          placeholder: match[0],
        });
      }
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((entry, index) => {
        walk(entry, node, path ? `${path}.${index}` : String(index));
      });
      return;
    }

    if (value !== null && typeof value === "object") {
      for (const [key, entry] of Object.entries(
        value as Record<string, unknown>,
      )) {
        walk(entry, node, path ? `${path}.${key}` : key);
      }
    }
  };

  for (const node of nodes) {
    walk(node.data ?? {}, node, "");
  }

  return pending;
}

/**
 * The credential placeholders a graph leaves to be bound, in node order.
 * `required === false` when the node's definition marks the credential
 * optional. Node ids are the caller's ids (already rotated when called from
 * `prepareTemplateGraph`).
 */
export function collectPendingCredentials(
  nodes: TemplateNode[],
): PendingCredential[] {
  const pending: PendingCredential[] = [];

  for (const node of nodes) {
    const registration = nodeRegistry.resolve(node.type);
    for (const requirement of registration.credentials ?? []) {
      pending.push({
        nodeId: node.id,
        nodeName: node.name ?? node.type,
        credentialType: requirement.type,
        credentialKey: requirement.key,
        optional: !requirement.required,
      });
    }
  }

  return pending;
}
