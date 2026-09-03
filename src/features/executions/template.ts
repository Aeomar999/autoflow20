import { format as dateFnsFormat } from "date-fns";
import Handlebars from "handlebars";

/**
 * Central template compilation for all node executors (ADR-0007).
 *
 * Posture: user-authored templates are a product feature, so runtime
 * compilation stays â€” but every executor must compile through this
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

// ---------------------------------------------------------------------------
// Expression helper set (AF-M9-07, ADR-0007 amendment)
//
// These make real-world (n8n-derived) templates portable. Each helper resolves
// to a scalar or returns a SafeString; none of them can read beyond the data
// context they are handed, so the AF-A-03 posture (own properties only, no
// globals) is unaffected. Structural/type failures throw `ExpressionError`
// naming the helper â€” a helper that silently emits garbage is a silent
// failure (engineering rule #1).
// ---------------------------------------------------------------------------

const isMissing = (value: unknown): boolean =>
  value === null || value === undefined;

const isBlank = (value: unknown): boolean => isMissing(value) || value === "";

const toNumber = (value: unknown, helper: string): number => {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;
  if (Number.isNaN(n)) {
    throw new ExpressionError(
      `Helper "${helper}": expected a number, got ${describe(value)}`,
      { expression: `{{${helper} â€¦}}` },
    );
  }
  return n;
};

const describe = (value: unknown): string => {
  if (typeof value === "string") return `the string ${JSON.stringify(value)}`;
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  return `${typeof value} ${JSON.stringify(value)}`;
};

/**
 * `{{default a b}}` â€” returns `a` when it "has a value" (not null, not
 * undefined, not the empty string), otherwise `b`. Ports n8n's `a || b`.
 */
Handlebars.registerHelper("default", (a: unknown, b: unknown) =>
  isBlank(a) ? b : a,
);

/**
 * `{{get obj "a.b.0.c"}}` â€” resolve a dotted/array path against an object
 * (n8n's optional-chaining `a?.b?.[0]`). A missing segment resolves to the
 * empty string (`""`), matching Handlebars' own miss-is-empty behaviour, so a
 * `node` executor never sees a thrown error for a merely-unset value.
 */
Handlebars.registerHelper("get", (obj: unknown, path: unknown) => {
  if (typeof path !== "string" || path === "") {
    throw new ExpressionError(
      `Helper "get": expected a non-empty string path, got ${describe(path)}`,
      { expression: '{{get obj "path.to.value"}}' },
    );
  }
  const segments = path.split(".");
  let current: unknown = obj;
  for (const segment of segments) {
    if (current === null || current === undefined) return "";
    if (typeof current !== "object") return "";
    const value = current as Record<string, unknown>;
    if (Object.hasOwn(value, segment)) {
      current = value[segment];
    } else {
      return "";
    }
  }
  return current ?? "";
});

const compare = (a: unknown, b: unknown): number => {
  const aNum = typeof a === "number" ? a : Number(a);
  const bNum = typeof b === "number" ? b : Number(b);
  if (Number.isFinite(aNum) && Number.isFinite(bNum)) {
    return aNum === bNum ? 0 : aNum < bNum ? -1 : 1;
  }
  const aStr = String(a ?? "");
  const bStr = String(b ?? "");
  return aStr === bStr ? 0 : aStr < bStr ? -1 : 1;
};

Handlebars.registerHelper(
  "eq",
  (a: unknown, b: unknown) => compare(a, b) === 0,
);
Handlebars.registerHelper(
  "ne",
  (a: unknown, b: unknown) => compare(a, b) !== 0,
);
Handlebars.registerHelper("gt", (a: unknown, b: unknown) => compare(a, b) > 0);
Handlebars.registerHelper(
  "gte",
  (a: unknown, b: unknown) => compare(a, b) >= 0,
);
Handlebars.registerHelper("lt", (a: unknown, b: unknown) => compare(a, b) < 0);
Handlebars.registerHelper(
  "lte",
  (a: unknown, b: unknown) => compare(a, b) <= 0,
);

Handlebars.registerHelper("and", (...args: unknown[]) =>
  args.slice(0, -1).every(Boolean),
);
Handlebars.registerHelper("or", (...args: unknown[]) =>
  args.slice(0, -1).some(Boolean),
);
Handlebars.registerHelper("not", (a: unknown) => !a);

Handlebars.registerHelper(
  "add",
  (a: unknown, b: unknown) => toNumber(a, "add") + toNumber(b, "add"),
);
Handlebars.registerHelper(
  "sub",
  (a: unknown, b: unknown) => toNumber(a, "sub") - toNumber(b, "sub"),
);
Handlebars.registerHelper(
  "mul",
  (a: unknown, b: unknown) => toNumber(a, "mul") * toNumber(b, "mul"),
);
Handlebars.registerHelper("div", (a: unknown, b: unknown) => {
  const divisor = toNumber(b, "div");
  if (divisor === 0) {
    throw new ExpressionError(`Helper "div": division by zero`, {
      expression: "{{div a b}}",
    });
  }
  return toNumber(a, "div") / divisor;
});

Handlebars.registerHelper("len", (value: unknown) => {
  if (typeof value === "string" || Array.isArray(value)) return value.length;
  if (value !== null && typeof value === "object") {
    return Object.keys(value).length;
  }
  if (isMissing(value)) return 0;
  return String(value).length;
});

Handlebars.registerHelper("upper", (value: unknown) => {
  if (typeof value !== "string") {
    throw new ExpressionError(
      `Helper "upper": expected a string, got ${describe(value)}`,
      { expression: "{{upper value}}" },
    );
  }
  return value.toUpperCase();
});

Handlebars.registerHelper("lower", (value: unknown) => {
  if (typeof value !== "string") {
    throw new ExpressionError(
      `Helper "lower": expected a string, got ${describe(value)}`,
      { expression: "{{lower value}}" },
    );
  }
  return value.toLowerCase();
});

/**
 * `{{formatDate value "yyyy-MM-dd"}}` â€” formats a date using the date-fns
 * format patterns. Accepts an ISO-8601 string, an epoch millisecond timestamp
 * (number), or an epoch-seconds timestamp. Returns the empty string for a
 * missing value; the date-fns `format` options (locale etc.) are intentionally
 * not exposed â€” a fixed en-US locale keeps output deterministic across runs.
 */
Handlebars.registerHelper("formatDate", (value: unknown, pattern: unknown) => {
  if (isMissing(value)) return "";
  let date: Date;
  if (value instanceof Date) {
    date = value;
  } else if (typeof value === "number") {
    date = new Date(value < 1e12 ? value * 1000 : value);
  } else if (typeof value === "string") {
    const iso = value.trim();
    if (iso === "") return "";
    date = new Date(iso);
  } else {
    throw new ExpressionError(
      `Helper "formatDate": expected a date string, Date, or number, got ${describe(value)}`,
      { expression: '{{formatDate value "yyyy-MM-dd"}}' },
    );
  }
  if (Number.isNaN(date.getTime())) {
    throw new ExpressionError(
      `Helper "formatDate": could not parse ${JSON.stringify(value)} as a date`,
      { expression: '{{formatDate value "yyyy-MM-dd"}}' },
    );
  }
  const format =
    typeof pattern === "string" && pattern !== ""
      ? pattern
      : "yyyy-MM-dd HH:mm:ss";
  return dateFnsFormat(date, format);
});

/**
 * `{{{json x}}}` — serialize a value as JSON text.
 *
 * `JSON.stringify` returns the JS value `undefined` (not a string) for
 * `undefined`, a function, or a symbol, and Handlebars then renders that as
 * the bare word `undefined` — which is **not valid JSON**. Because the usual
 * use of this helper is to build a JSON payload (an HTTP body, a typed `SET`
 * assignment), that silently produced a malformed document whenever a
 * templated path happened to be absent: the far end got a syntax error it
 * could not attribute, and a typed `SET` failed with `resolved to "undefined"`.
 *
 * Emitting `null` instead is the correct JSON representation of "no value"
 * and is always parseable. Found by the AF-M9-16 acceptance suite, where a
 * `ping` request carrying no `payload` crashed W1.
 */
Handlebars.registerHelper("json", (context) => {
  const jsonString = JSON.stringify(context, null, 2);
  return new Handlebars.SafeString(
    jsonString === undefined ? "null" : jsonString,
  );
});

/**
 * The app-registered expression helpers (AF-M9-07). Single source of truth for
 * both runtime registration and for template root-extraction: a name in this
 * set (or in the Handlebars built-ins below) is treated as a *helper callee* in
 * the path position of a `{{â€¦}}` expression, never as a data root.
 */
export const EXPRESSION_HELPERS: readonly string[] = [
  "default",
  "get",
  "eq",
  "ne",
  "gt",
  "gte",
  "lt",
  "lte",
  "and",
  "or",
  "not",
  "add",
  "sub",
  "mul",
  "div",
  "len",
  "upper",
  "lower",
  "formatDate",
  "json",
];

/**
 * Handlebars' own built-in helpers/block helpers. Listed separately from
 * `EXPRESSION_HELPERS` because they are not ours to register, but templates
 * (`{{#if ok}}`, `{{lookup map key}}`) legitimately use them, so root
 * extraction must not mistake them for data roots either.
 */
const BUILTIN_HELPERS: readonly string[] = [
  "if",
  "unless",
  "each",
  "with",
  "lookup",
  "log",
  "helperMissing",
  "blockHelperMissing",
];

const HELPER_SET: ReadonlySet<string> = new Set([
  ...EXPRESSION_HELPERS,
  ...BUILTIN_HELPERS,
]);

function templateRootFromPath(path: unknown, out: string[]): void {
  if (!path || typeof path !== "object") return;
  const p = path as {
    type?: string;
    parts?: string[];
    data?: boolean;
    original?: string;
  };
  if (
    p.type === "PathExpression" &&
    p.data === false &&
    p.parts &&
    p.parts.length > 0 &&
    !p.original?.startsWith("@") &&
    !HELPER_SET.has(p.parts[0])
  ) {
    out.push(p.parts[0]);
  }
}

function walkTemplateAst(node: unknown, out: string[]): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) walkTemplateAst(child, out);
    return;
  }
  const n = node as {
    type?: string;
    path?: unknown;
    params?: unknown[];
    hash?: { type?: string; pairs?: unknown[] };
    program?: unknown;
    inverse?: unknown;
    body?: unknown[];
    name?: unknown;
    parts?: string[];
    data?: boolean;
    original?: string;
    pairs?: unknown[];
  };
  switch (n.type) {
    case "Program":
      (n.body ?? []).forEach((c) => {
        walkTemplateAst(c, out);
      });
      return;
    case "MustacheStatement":
    case "BlockStatement":
    case "SubExpression": {
      templateRootFromPath(n.path, out);
      (n.params ?? []).forEach((c) => {
        walkTemplateAst(c, out);
      });
      if (n.hash && n.hash.type === "Hash") {
        (n.hash.pairs ?? []).forEach((c) => {
          walkTemplateAst(c, out);
        });
      }
      if (n.program) walkTemplateAst(n.program, out);
      if (n.inverse) walkTemplateAst(n.inverse, out);
      return;
    }
    case "PartialStatement":
      // The partial name is not a data root; only its hash/params are.
      (n.params ?? []).forEach((c) => {
        walkTemplateAst(c, out);
      });
      if (n.hash && n.hash.type === "Hash") {
        (n.hash.pairs ?? []).forEach((c) => {
          walkTemplateAst(c, out);
        });
      }
      return;
    case "Hash":
      (n.pairs ?? []).forEach((c) => {
        walkTemplateAst(c, out);
      });
      return;
    case "PathExpression":
      templateRootFromPath(node, out);
      return;
    default:
      // Number/String/Boolean/Undefined/Null literals, ContentStatement,
      // CommentStatement, and anything else carry no data-root reference.
      return;
  }
}

/**
 * Extract the top-level data-root identifiers referenced by a Handlebars
 * template, e.g. `{{webhook.body.x}}` â†’ `["webhook"]`, `{{$json.body}}` â†’
 * `["$json"]`, `{{default a (get obj "x")}}` â†’ `["a", "obj"]`. Helper callees
 * (both our expression helpers and Handlebars' built-ins) are not data roots;
 * `@data` references and string/number literals are ignored. Used by the graph
 * validator (AF-M9-07) to warn when a template references a root the workflow
 * cannot produce, so a ported expression fails loudly instead of silently
 * rendering as `""`.
 */
export const getTemplateRoots = (source: string): string[] => {
  let ast: unknown;
  try {
    ast = Handlebars.parse(source);
  } catch {
    // An already-invalid template is the executor's/renderer's problem at run
    // time, not a root-mismatch warning at save time.
    return [];
  }
  const out: string[] = [];
  walkTemplateAst(ast, out);
  return [...new Set(out)];
};

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
 * - `$json` â€” alias for the accumulated context (what was previously
 *   just `context`).
 * - `$node["NodeName"]` â€” resolves to the individual output of the
 *   named upstream node.
 * - `$execution.id` â€” the current execution id.
 * - `$workflow.id` â€” the current workflow id.
 * - `$now` â€” ISO-8601 timestamp of when the template was compiled
 *   (deterministic within a step).
 */
export type TemplateContext = Record<string, unknown> & {
  $json: Record<string, unknown>;
  $node: NodeOutputMap;
  $execution: { id: string };
  $workflow: { id: string };
  $now: string;
  $item?: unknown;
  $itemIndex?: number;
};

/**
 * Per-item fan-out scope (AF-M9-14, ADR-0021). When present, `$item` and
 * `$itemIndex` are merged into the enriched template context at the highest
 * precedence, so a segment interior node's templates resolve against the
 * current item. Absent for top-level (non fan-out) nodes.
 */
export type ItemFanoutScope = { $item: unknown; $itemIndex: number };

/**
 * Thrown when a template expression references a path that cannot be
 * resolved. Not thrown for simple missing keys (Handlebars renders
 * those as empty strings) â€” this is reserved for structural errors
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
 * @param itemScope - optional fan-out scope (AF-M9-14) adding `$item` /
 *   `$itemIndex` at the highest precedence for a segment interior node.
 * @returns a new object with `$json`, `$node`, `$execution`,
 *   `$workflow`, and `$now` added on top of `accumulatedContext`.
 */
export const buildTemplateContext = (
  accumulatedContext: Record<string, unknown>,
  nodeOutputs: NodeOutputMap,
  meta: TemplateMeta,
  itemScope?: ItemFanoutScope,
): TemplateContext => {
  return {
    ...accumulatedContext,
    ...itemScope,
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
 * closure â€” it is never passed to the executor as `context`, so it cannot be
 * spread into a return value and persisted. That is the whole point: before
 * AF-M9-05 executors compiled templates against the enriched object *and*
 * returned `{ ...context, â€¦ }`, so `$json` (which self-references the context)
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
  itemScope?: ItemFanoutScope,
): TemplateResolver => {
  const enriched = buildTemplateContext(
    accumulatedContext,
    nodeOutputs,
    meta,
    itemScope,
  );
  return (template: string) => compileTemplate(template)(enriched);
};
