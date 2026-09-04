import {
  type ResolvedConfigField,
  resolveConfigFields,
  UnsupportedConfigFieldError,
} from "@/features/editor/lib/config-schema";
import { nodeManifest } from "@/nodes/manifest";
import { outputPorts } from "@/nodes/ports";
import type { NodeCategory, NodeDefinition } from "@/nodes/types";

/**
 * The node reference model (AF-M8-09).
 *
 * Derived from `nodeManifest` at render time rather than written by hand or
 * generated into checked-in files. Both alternatives drift: a hand-written
 * page is stale the first time someone adds a config field, and a generated
 * file is stale until somebody remembers to re-run the generator. Reading the
 * registry means the reference cannot disagree with the product - it is the
 * same `NodeDefinition` the palette, the config panel, and `validate()` use
 * (ADR-0001).
 *
 * Config fields come from `resolveConfigFields`, the deriver that builds the
 * editor's config form. So the documented fields are, by construction, the
 * fields the editor renders - not a second description of them.
 */

export interface NodeReferenceEntry {
  type: string;
  label: string;
  description: string;
  category: NodeCategory;
  version: number;
  keywords: string[];
  inputs: {
    id: string;
    label: string;
    required: boolean;
    description?: string;
  }[];
  outputs: { id: string; label: string; description?: string }[];
  credentials: {
    key: string;
    type: string;
    required: boolean;
    /** OAuth scope NAMES the node needs (AF-M10-17). Never a value. */
    scopes?: readonly string[];
  }[];
  /**
   * Null when the node's schema uses a shape the config deriver does not
   * support. The page says so rather than pretending the node has no
   * configuration - an empty table would be a lie, an absent one is a gap.
   */
  fields: ResolvedConfigField[] | null;
  defaultRetry?: { maxAttempts: number; backoffMs: number };
  timeoutMs?: number;
  supportsResponseCache: boolean;
  deprecated?: { since: string; replacedBy: string; reason: string };
  isTrigger: boolean;
}

/** Display order for category groupings: the order a workflow is built in. */
export const CATEGORY_ORDER: readonly NodeCategory[] = [
  "TRIGGER",
  "ACTION",
  "AI",
  "LOGIC",
  "DATA",
  "TRANSFORM",
];

export const CATEGORY_LABELS: Readonly<Record<NodeCategory, string>> = {
  TRIGGER: "Triggers",
  ACTION: "Actions",
  AI: "AI",
  LOGIC: "Logic",
  DATA: "Data",
  TRANSFORM: "Transform",
};

const toEntry = (definition: NodeDefinition): NodeReferenceEntry => {
  let fields: ResolvedConfigField[] | null;
  try {
    fields = resolveConfigFields(
      definition.configSchema,
      definition.credentials ?? [],
    );
  } catch (error) {
    if (!(error instanceof UnsupportedConfigFieldError)) {
      throw error;
    }
    // A schema the config form cannot render is a real gap, not a crash: the
    // reference degrades to "not documented" for this node and keeps serving
    // every other one.
    fields = null;
  }

  return {
    type: definition.type,
    label: definition.label,
    description: definition.description,
    category: definition.category,
    version: definition.version,
    keywords: definition.keywords ?? [],
    inputs: definition.inputs.map((port) => ({
      id: port.id,
      label: port.label,
      required: port.required ?? false,
      description: port.description,
    })),
    outputs: outputPorts(definition.type, definition.defaults).map((port) => ({
      id: port.id,
      label: port.label,
      description: port.description,
    })),
    credentials: definition.credentials ?? [],
    fields,
    defaultRetry: definition.defaultRetry,
    timeoutMs: definition.timeoutMs,
    supportsResponseCache: definition.supportsResponseCache ?? false,
    deprecated: definition.deprecated,
    // A node with no input ports starts a workflow. Derived rather than read
    // off the category, because that is what the engine actually means by it.
    isTrigger: definition.inputs.length === 0,
  };
};

/**
 * Every node type, including deprecated ones.
 *
 * Deprecated types are documented deliberately: a saved workflow can still
 * contain one and still run it (ADR-0011), so someone reading a trace needs
 * to be able to look it up. The entry carries the deprecation notice so the
 * page can say what replaced it.
 */
export const nodeReference = (): NodeReferenceEntry[] =>
  nodeManifest.map(toEntry);

export const findNodeReference = (
  type: string,
): NodeReferenceEntry | undefined => {
  const definition = nodeManifest.find((node) => node.type === type);
  return definition ? toEntry(definition) : undefined;
};

/** Entries grouped for display, in `CATEGORY_ORDER`, empty groups dropped. */
export const nodeReferenceByCategory = (): {
  category: NodeCategory;
  label: string;
  entries: NodeReferenceEntry[];
}[] => {
  const all = nodeReference();

  return CATEGORY_ORDER.map((category) => ({
    category,
    label: CATEGORY_LABELS[category],
    entries: all
      .filter((entry) => entry.category === category)
      .sort((a, b) => a.label.localeCompare(b.label)),
  })).filter((group) => group.entries.length > 0);
};
