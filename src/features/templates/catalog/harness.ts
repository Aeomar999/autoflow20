import { validate } from "@/engine/validate";
import {
  buildTestGraph,
  buildTestRunPlan,
} from "@/features/workflows/server/test-run";
import { parseModelChain } from "@/lib/ai/fallback";
import { AI_PROVIDERS, findAiModel } from "@/lib/ai/registry";
import { outputPorts } from "@/nodes/ports";
import { nodeRegistry } from "@/nodes/registry";

import { TEMPLATE_CATEGORIES } from "../constants";
import { collectPendingCredentials } from "../server/instantiate";
import type { TemplateSpec } from "./types";

/**
 * Template authoring harness (AF-M7-02).
 *
 * Every authored template runs through this before it can be seeded. It is the
 * gate the acceptance criteria describe, and it is deliberately pure — no DB,
 * no network — so it runs in the unit suite AND inside `seed:templates`, and a
 * template can never reach the gallery without having passed it.
 *
 * What the smoke check does and does not cover
 * --------------------------------------------
 * `smokeRunTemplate` drives each graph through the SAME planner the in-editor
 * test run uses (`buildTestGraph` → `buildTestRunPlan`, from
 * `src/features/workflows/server/test-run.ts`), which validates the graph
 * against the live registry and computes the execution order. That proves the
 * template compiles to a runnable plan.
 *
 * It does NOT dispatch the plan to Inngest, so it makes no third-party calls.
 * A template that reaches Slack, Stripe, or an LLM cannot be executed for real
 * in CI without live credentials for someone's account, and a suite that
 * needed those would be a suite nobody could run. Everything that is knowable
 * without those calls — node types, wiring, per-node config schemas, credential
 * placeholders, reachability — is checked here and is checked hard.
 */

/** A single problem found with one template. */
export interface TemplateIssue {
  slug: string;
  /** Node the problem belongs to, when it is node-scoped. */
  nodeId?: string;
  message: string;
}

export interface TemplateCheckResult {
  slug: string;
  issues: TemplateIssue[];
  /** Derived, not authored — what the seeder writes to the `Template` row. */
  nodeCount: number;
  credentialCount: number;
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const NODE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UUID_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * Token shapes that mean a real secret was pasted into an authored graph.
 * Deliberately literal: a heuristic that flagged "anything long" would be
 * turned off within a week, and a disabled check is worse than none.
 */
const SECRET_PREFIXES = [
  "sk-",
  "sk_live_",
  "sk_test_",
  "pk_live_",
  "rk_live_",
  "xoxb-",
  "xoxp-",
  "xapp-",
  "ghp_",
  "gho_",
  "github_pat_",
  "whsec_",
  "AIza",
  "ya29.",
  "AKIA",
  "patAirtable",
  "pat.",
];

/**
 * A cuid2 the author forgot to strip — the specific leak
 * `stripCredentialFields` exists to prevent, caught at authoring time so it
 * never reaches a `Template` row in the first place.
 *
 * Requires a digit: cuid2 is 24 lowercase alphanumerics and effectively always
 * contains one, while a 24-letter run of prose does not. Without that clause
 * the check fires on ordinary words and gets deleted.
 */
function looksLikeCuid(token: string): boolean {
  if (token.length < 24 || token.length > 32) return false;
  if (!/^[a-z][a-z0-9]*$/.test(token)) return false;
  return /[0-9]/.test(token);
}

function looksLikeSecret(token: string): boolean {
  return SECRET_PREFIXES.some((prefix) => token.startsWith(prefix));
}

/** Every string value reachable from a config object, with its key path. */
function* walkStrings(
  value: unknown,
  path: string,
): Generator<{ path: string; value: string }> {
  if (typeof value === "string") {
    yield { path, value };
    return;
  }
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      yield* walkStrings(entry, `${path}[${index}]`);
    }
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      yield* walkStrings(entry, path ? `${path}.${key}` : key);
    }
  }
}

/**
 * Assert no author-side identifier or secret survived into `node.data`.
 * A template is public product content: anything in it ships to every tenant.
 */
function checkForLeaks(spec: TemplateSpec, issues: TemplateIssue[]): void {
  for (const node of spec.graph.nodes) {
    const registration = nodeRegistry.has(node.type)
      ? nodeRegistry.resolve(node.type)
      : undefined;

    /**
     * Every authored key must be one the node's schema actually reads.
     *
     * Zod objects here are not `.strict()`, so an unknown key passes
     * validation silently and the field it was meant to set stays undefined.
     * That is not a typo-level problem: a `CONDITION` authored with
     * `leftValue`/`rightValue` instead of `left`/`right` parses cleanly, then
     * compares undefined to undefined at run time and takes the same branch
     * every time — a template that looks correct, validates, executes, and is
     * wrong. Two shipped M10 templates did exactly this (AF-M10-17).
     *
     * Making the schemas strict would be the deeper fix, but it changes the
     * SAVE boundary for every existing user workflow. This catches it where it
     * belongs: in authored content, before it reaches the gallery.
     */
    const shape = registration
      ? (
          registration.configSchema as unknown as {
            shape?: Record<string, unknown>;
          }
        ).shape
      : undefined;
    if (shape && node.data) {
      const known = new Set(Object.keys(shape));
      for (const key of Object.keys(node.data)) {
        // `_`-prefixed keys belong to the engine, not to the node's schema:
        // AF-M9-06's `_run` policy block is read by `resolveRunPolicy` and is
        // deliberately absent from every configSchema.
        if (key.startsWith("_")) continue;
        if (!known.has(key)) {
          issues.push({
            slug: spec.slug,
            nodeId: node.id,
            message: `Config field "${key}" is not in ${node.type}'s schema, so it is ignored at run time. Known fields: ${[...known].sort().join(", ")}.`,
          });
        }
      }
    }

    // Credential-bound fields must be ABSENT, not empty. An authored value
    // here would be the author's own credential id.
    for (const requirement of registration?.credentials ?? []) {
      if (
        node.data !== undefined &&
        Object.hasOwn(node.data, requirement.key)
      ) {
        issues.push({
          slug: spec.slug,
          nodeId: node.id,
          message: `Config field "${requirement.key}" is credential-bound and must not be authored into a template.`,
        });
      }
    }

    for (const { path, value } of walkStrings(node.data ?? {}, "")) {
      if (UUID_PATTERN.test(value)) {
        issues.push({
          slug: spec.slug,
          nodeId: node.id,
          message: `Config field "${path}" contains a UUID — replace it with a placeholder.`,
        });
      }
      for (const token of value.split(/[^A-Za-z0-9_.-]+/)) {
        if (!token) continue;
        if (looksLikeCuid(token)) {
          issues.push({
            slug: spec.slug,
            nodeId: node.id,
            message: `Config field "${path}" contains what looks like a cuid ("${token}") — replace it with a placeholder.`,
          });
        }
        if (looksLikeSecret(token)) {
          issues.push({
            slug: spec.slug,
            nodeId: node.id,
            message: `Config field "${path}" contains a token with a known secret prefix — replace it with a placeholder.`,
          });
        }
      }
    }
  }
}

function checkMetadata(spec: TemplateSpec, issues: TemplateIssue[]): void {
  if (!SLUG_PATTERN.test(spec.slug)) {
    issues.push({
      slug: spec.slug,
      message: "Slug must be kebab-case ([a-z0-9] segments joined by '-').",
    });
  }
  if (spec.name.trim().length === 0) {
    issues.push({ slug: spec.slug, message: "Name is empty." });
  }
  if (spec.description.trim().length < 40) {
    issues.push({
      slug: spec.slug,
      message:
        "Description is too short to be useful in the gallery (min 40 chars).",
    });
  }
  if (!TEMPLATE_CATEGORIES.includes(spec.category as "All")) {
    issues.push({
      slug: spec.slug,
      message: `Category "${spec.category}" is not a gallery filter — add it to TEMPLATE_CATEGORIES or use an existing one.`,
    });
  }
  if (spec.category === "All") {
    issues.push({
      slug: spec.slug,
      message: '"All" is the filter reset, not a category.',
    });
  }
  if (spec.tags.length === 0) {
    issues.push({ slug: spec.slug, message: "At least one tag is required." });
  }
}

function checkGraphShape(spec: TemplateSpec, issues: TemplateIssue[]): void {
  const { nodes, edges } = spec.graph;

  if (nodes.length === 0) {
    issues.push({ slug: spec.slug, message: "Template graph has no nodes." });
    return;
  }

  const seen = new Set<string>();
  for (const node of nodes) {
    if (!NODE_ID_PATTERN.test(node.id)) {
      issues.push({
        slug: spec.slug,
        nodeId: node.id,
        message:
          "Node ids must be authored kebab-case slugs, not generated ids.",
      });
    }
    if (seen.has(node.id)) {
      issues.push({
        slug: spec.slug,
        nodeId: node.id,
        message: "Duplicate node id.",
      });
    }
    seen.add(node.id);

    if (!nodeRegistry.has(node.type)) {
      issues.push({
        slug: spec.slug,
        nodeId: node.id,
        message: `Unknown node type "${node.type}".`,
      });
      continue;
    }

    // A template is the one place a NEW node of a type gets created, so
    // authoring a deprecated type would re-grow a population ADR 0011 exists
    // to shrink.
    const registration = nodeRegistry.resolve(node.type);
    if (registration.deprecated) {
      issues.push({
        slug: spec.slug,
        nodeId: node.id,
        message: `Node type "${node.type}" is deprecated (use "${registration.deprecated.replacedBy}").`,
      });
    }
    if (!node.name || node.name.trim().length === 0) {
      issues.push({
        slug: spec.slug,
        nodeId: node.id,
        message: "Every template node needs a human-readable name.",
      });
    }
  }

  for (const [index, edge] of edges.entries()) {
    if (!seen.has(edge.source) || !seen.has(edge.target)) {
      issues.push({
        slug: spec.slug,
        message: `Edge ${index} references a node that is not in the graph (${edge.source} → ${edge.target}).`,
      });
      continue;
    }
    const sourceNode = nodes.find((n) => n.id === edge.source);
    if (!sourceNode || !nodeRegistry.has(sourceNode.type)) continue;
    // Config-dependent nodes (SWITCH) derive their ports from config, so the
    // port set must be resolved through the same shared helper the editor,
    // validator and engine use — the static `outputs` array is empty for them.
    const outputs = outputPorts(sourceNode.type, sourceNode.data);
    const handle = edge.sourceHandle ?? "main";
    if (!outputs.some((port) => port.id === handle)) {
      issues.push({
        slug: spec.slug,
        nodeId: edge.source,
        message: `Edge ${index} leaves through port "${handle}", which "${sourceNode.type}" does not declare (has: ${outputs.map((p) => p.id).join(", ")}).`,
      });
    }
  }
}

/**
 * Drive the template through the in-editor test-run planner: registry
 * validation plus a deterministic execution order.
 *
 * Warnings are escalated to failures. `validate()` reports an unreachable node
 * as a warning because a half-built canvas is a normal thing for a user to be
 * looking at — but shipped gallery content is finished work, so a node no
 * trigger can reach is a bug in the template. `buildTestRunPlan` only raises
 * `severity: "error"`, which is why the warning pass is a separate call rather
 * than something the planner could have caught for us.
 */
function smokeRunTemplate(spec: TemplateSpec, issues: TemplateIssue[]): void {
  const graph = buildTestGraph(
    spec.graph.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      data: n.data ?? {},
    })),
    spec.graph.edges,
  );

  // `buildTestGraph` names nodes after their type; the authored names are what
  // the user sees, and validation warnings quote them.
  for (const node of graph.nodes) {
    const authored = spec.graph.nodes.find((n) => n.id === node.id);
    if (authored?.name) node.name = authored.name;
  }

  try {
    const plan = buildTestRunPlan(graph);
    if (plan.graphSnapshot.nodes.length !== spec.graph.nodes.length) {
      issues.push({
        slug: spec.slug,
        message: "Planned graph dropped nodes.",
      });
    }
  } catch (error) {
    issues.push({
      slug: spec.slug,
      message: `Smoke run failed: ${error instanceof Error ? error.message : String(error)}`,
    });
    return;
  }

  const { errors } = validate(
    { nodes: graph.nodes, connections: graph.connections },
    nodeRegistry,
  );
  for (const warning of errors.filter((e) => e.severity === "warning")) {
    issues.push({
      slug: spec.slug,
      nodeId: warning.nodeId,
      message: `Smoke run warning: ${warning.message}`,
    });
  }
}

/**
 * Model ids on the registry-backed AI nodes must resolve.
 *
 * `configSchema` only enforces the `provider:model` CHARACTER SET, so a typo
 * ("openai:gpt-4o-mimi") saves cleanly and fails at run time with
 * `UnknownAiModelError` — for the user, on their first run of a template we
 * shipped. `OPENAI_COMPATIBLE_CHAT` is excluded on purpose: its model id names
 * whatever the user's own endpoint serves and is not ours to validate.
 */
const REGISTRY_BACKED_AI_TYPES = new Set(["AI_LLM", "AI_EXTRACT"]);

function checkAiModels(spec: TemplateSpec, issues: TemplateIssue[]): void {
  for (const node of spec.graph.nodes) {
    if (!REGISTRY_BACKED_AI_TYPES.has(node.type)) continue;
    const data = (node.data ?? {}) as {
      model?: unknown;
      fallbackModels?: unknown;
    };
    const candidates = parseModelChain(
      typeof data.model === "string" ? data.model : undefined,
      typeof data.fallbackModels === "string" ? data.fallbackModels : undefined,
    );
    for (const candidate of candidates) {
      const isBareProvider = (AI_PROVIDERS as readonly string[]).includes(
        candidate,
      );
      if (!isBareProvider && !findAiModel(candidate)) {
        issues.push({
          slug: spec.slug,
          nodeId: node.id,
          message: `Model "${candidate}" is not in the AI registry (src/lib/ai/registry.ts).`,
        });
      }
    }
  }
}

/** Run every check against one template. */
export function checkTemplate(spec: TemplateSpec): TemplateCheckResult {
  const issues: TemplateIssue[] = [];

  checkMetadata(spec, issues);
  checkGraphShape(spec, issues);

  // The remaining checks resolve node types; skip them when the graph already
  // failed shape validation, so one bad type does not produce ten errors.
  const shapeIsSound = issues.every((issue) => !issue.nodeId);
  if (shapeIsSound) {
    checkForLeaks(spec, issues);
    checkAiModels(spec, issues);
    smokeRunTemplate(spec, issues);
  }

  return {
    slug: spec.slug,
    issues,
    nodeCount: spec.graph.nodes.length,
    credentialCount: countRequiredCredentials(spec),
  };
}

/**
 * How many credentials the user must **connect** before this template can run.
 *
 * Optional requirements (every AI provider key, which the node falls back
 * from) are excluded: the gallery's "fewest credentials" sort is a promise
 * about setup effort, and counting optional keys would break that promise.
 *
 * **Distinct types, not bindings** (corrected in AF-M10-15). This used to
 * count every credential *field* in the graph, which was indistinguishable
 * while no template used two nodes of the same service. M10's families break
 * that: a Sheets template reads a row and writes it back, and both nodes want
 * the same `google.sheets` credential. The user connects Google once and picks
 * it from a dropdown twice, so counting two overstates the setup effort the
 * number exists to describe — and would have pushed every realistic
 * multi-step template over the one-credential onboarding bar for no reason a
 * user would recognise.
 */
export function countRequiredCredentials(spec: TemplateSpec): number {
  const nodes = spec.graph.nodes.filter((node) => nodeRegistry.has(node.type));
  const required = collectPendingCredentials(nodes).filter((c) => !c.optional);
  return new Set(required.map((c) => c.credentialType)).size;
}

/** Run every check across the whole catalogue, including cross-template ones. */
export function checkCatalog(specs: TemplateSpec[]): TemplateCheckResult[] {
  const results = specs.map(checkTemplate);

  const bySlug = new Map<string, number>();
  for (const spec of specs) {
    bySlug.set(spec.slug, (bySlug.get(spec.slug) ?? 0) + 1);
  }
  for (const [slug, count] of bySlug) {
    if (count > 1) {
      const result = results.find((r) => r.slug === slug);
      result?.issues.push({
        slug,
        message: `Duplicate slug: ${count} templates share it. Slugs are the gallery's primary key.`,
      });
    }
  }

  return results;
}

/** Flatten a catalogue check into one report line per issue. */
export function formatIssues(results: TemplateCheckResult[]): string[] {
  return results.flatMap((result) =>
    result.issues.map(
      (issue) =>
        `${issue.slug}${issue.nodeId ? ` [${issue.nodeId}]` : ""}: ${issue.message}`,
    ),
  );
}
