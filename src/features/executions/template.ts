import Handlebars from "handlebars";

/**
 * Central template compilation for all node executors (ADR-0007).
 *
 * Posture: user-authored templates are a product feature, so runtime
 * compilation stays — but every executor must compile through this
 * wrapper, which pins the safe runtime options explicitly instead of
 * relying on Handlebars' current defaults:
 *
 * - Prototype access (constructor / __proto__ / non-own properties)
 *   is denied at render time. Templates can only read own properties
 *   of the data context they are given.
 * - There is no path to globals: `process`, `globalThis`, etc. only
 *   resolve if present in the context, which the engine never puts there.
 * - Output is always HTML-escaped unless a helper deliberately returns
 *   SafeString (e.g. `json`).
 */

Handlebars.registerHelper("json", (context) => {
  const jsonString = JSON.stringify(context, null, 2);
  return new Handlebars.SafeString(jsonString);
});

/**
 * Each node executor returns its own output bag. The engine accumulates
 * these into a flat context for downstream templates, but also keeps
 * the per-node outputs separate so that `$node["Name"]` can resolve.
 */
export type NodeOutput = Record<string, unknown>;

/**
 * Map from node name (as displayed on the canvas) to that node's
 * individual output bag. Populated by the engine after each executor
 * returns.
 */
export type NodeOutputMap = Record<string, NodeOutput>;

/**
 * Metadata the engine injects into every template context so that
 * templates can reference workflow / execution identifiers and the
 * current wall-clock time.
 */
export type TemplateMeta = {
  executionId: string;
  workflowId: string;
};

/**
 * The full context object passed to `compileTemplate`. Extends the
 * accumulated context from upstream nodes with the `$`-prefixed
 * helpers that AF-M2-03 adds.
 *
 * - `$json` — alias for the accumulated context (what was previously
 *   just `context`).
 * - `$node["NodeName"]` — resolves to the individual output of the
 *   named upstream node.
 * - `$execution.id` — the current execution id.
 * - `$workflow.id` — the current workflow id.
 * - `$now` — ISO-8601 timestamp of when the template was compiled
 *   (deterministic within a step).
 */
export type TemplateContext = Record<string, unknown> & {
  $json: Record<string, unknown>;
  $node: NodeOutputMap;
  $execution: { id: string };
  $workflow: { id: string };
  $now: string;
};

/**
 * Thrown when a template expression references a path that cannot be
 * resolved. Not thrown for simple missing keys (Handlebars renders
 * those as empty strings) — this is reserved for structural errors
 * such as malformed `$node` syntax or circular references that the
 * engine detects before compilation.
 */
export class ExpressionError extends Error {
  readonly expression: string;
  readonly nodeName?: string;

  constructor(
    message: string,
    opts: { expression: string; nodeName?: string },
  ) {
    super(message);
    this.name = "ExpressionError";
    this.expression = opts.expression;
    this.nodeName = opts.nodeName;
  }
}

export type SafeTemplate = (context: Record<string, unknown>) => string;

export const compileTemplate = (source: string): SafeTemplate => {
  const compiled = Handlebars.compile(source);

  return (context) =>
    compiled(context ?? {}, {
      allowProtoPropertiesByDefault: false,
      allowProtoMethodsByDefault: false,
    });
};

/**
 * Build the enriched template context that `compileTemplate` will
 * receive. Call this once per node, right before compiling the node's
 * config templates.
 *
 * @param accumulatedContext - the flat bag of all upstream outputs
 *   (what executors have returned so far).
 * @param nodeOutputs - per-node output map; the engine maintains this
 *   alongside `accumulatedContext`.
 * @param meta - execution/workflow identifiers.
 * @returns a new object with `$json`, `$node`, `$execution`,
 *   `$workflow`, and `$now` added on top of `accumulatedContext`.
 */
export const buildTemplateContext = (
  accumulatedContext: Record<string, unknown>,
  nodeOutputs: NodeOutputMap,
  meta: TemplateMeta,
): TemplateContext => {
  return {
    ...accumulatedContext,
    $json: accumulatedContext,
    $node: nodeOutputs,
    $execution: { id: meta.executionId },
    $workflow: { id: meta.workflowId },
    $now: new Date().toISOString(),
  };
};

/**
 * The `resolve` a node executor receives (AF-M9-05).
 *
 * The enriched context is built once, here, and captured by the returned
 * closure — it is never passed to the executor as `context`, so it cannot be
 * spread into a return value and persisted. That is the whole point: before
 * AF-M9-05 executors compiled templates against the enriched object *and*
 * returned `{ ...context, … }`, so `$json` (which self-references the context)
 * re-nested at every hop and the stored payload grew superlinearly with node
 * count, eating into the ADR-0018 per-node output cap.
 *
 * The engine and the node unit tests both build their resolver here, so a test
 * cannot drift from what the runner actually does.
 */
export type TemplateResolver = (template: string) => string;

export const makeResolver = (
  accumulatedContext: Record<string, unknown>,
  nodeOutputs: NodeOutputMap,
  meta: TemplateMeta,
): TemplateResolver => {
  const enriched = buildTemplateContext(accumulatedContext, nodeOutputs, meta);
  return (template: string) => compileTemplate(template)(enriched);
};
