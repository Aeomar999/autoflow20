# ADR-0007: Handlebars runtime compilation stays; access is sandboxed

**Status:** Accepted · **Date:** 2026-08-24 (amended 2026-08-26 for AF-M2-03; 2026-09-03 for AF-M9-07)
**Deciders:** Jerry (owner) + agent proposal
**Related:** AF-A-03, ADR-0006 (expressions-not-eval), M2-03 (full expression resolver)

## Context

Node config strings (`endpoint`, `body`, `content`, prompts) are user-authored
templates compiled at runtime with `Handlebars.compile` in every executor
(http-request, slack, discord, openai, gemini, anthropic). The audit flagged
runtime template compilation as an acute injection risk: Handlebars templates
are a small language, but naive use allows prototype-chain reads
(`{{constructor.name}}`, `{{__proto__...}}`) and, if a context ever leaked
globals, arbitrary environment access (`{{process.env.SECRET}}`).

Two postures were considered:

1. **Replace runtime compile with a precompiled safe subset** — a custom
   `{{path.to.value}}` interpolator only. Safest, but loses helpers,
   conditionals (`{{#if}}`), iteration, and the `json` helper users already
   rely on; the full resolver is not scheduled until M2-03.
2. **Keep Handlebars, pin its sandbox defaults explicitly** — Handlebars ≥4.7
   denies non-"own property" access by default and resolves identifiers only
   against the supplied data context.

## Decision

Option 2 — keep runtime compilation, harden it centrally:

- All executors compile through `src/features/executions/template.ts`
  → `compileTemplate(source)`, which wraps `Handlebars.compile` and invokes the
  compiled function with `allowProtoPropertiesByDefault: false` and
  `allowProtoMethodsByDefault: false`. These are pinned explicitly rather than
  inherited, so a Handlebars upgrade cannot silently relax them.
- Prototype-chain probes (`constructor`, `__proto__`, `toString`,
  `hasOwnProperty`) render as empty strings; they cannot reach object internals.
- There is no route to globals: `process`, `globalThis`, `require` resolve to
  nothing because the engine never places them in the data context.
- Output remains HTML-escaped by default; the one deliberate raw helper (`json`)
  emits `JSON.stringify` of own properties only.
- Direct `Handlebars.compile` usage outside the wrapper is banned going forward;
  new executors must import from `template.ts`.

### AF-M2-03 amendment: `$`-prefixed context helpers

The expression surface was extended in M2-03 so that templates can reference
execution metadata and upstream node outputs by name. `buildTemplateContext()`
constructs the enriched context that executors receive:

| Expression | Resolves to | Implementation |
|---|---|---|
| `{{$json.field}}` | Alias for the accumulated context. `{{$json}}` == the flat bag. | Spread in `buildTemplateContext` |
| `{{$node.[Node Name].field}}` | Output of a specific upstream node, keyed by canvas display name. | `nodeOutputs` map maintained by the engine |
| `{{$execution.id}}` | Current execution id. | `TemplateMeta` |
| `{{$workflow.id}}` | Current workflow id. | `TemplateMeta` |
| `{{$now}}` | ISO-8601 timestamp at context build time. | `new Date().toISOString()` |

`$node` access uses Handlebars' `lookup` helper or dot-bracket syntax
(`{{$node.[Name]}}`) — no custom parser needed. The existing sandbox
properties (`allowProtoPropertiesByDefault: false`) apply to all `$`-prefixed
properties equally.

`$env` is intentionally omitted for Phase 1. It can be added later by passing
an allowlisted subset of `process.env` into `buildTemplateContext` — the
plumbing is the same as `$execution`/`$workflow`. `$items` (n8n-style item
array) is deferred with the items model (Decision A).

### `ExpressionError`

A dedicated error class (`ExpressionError`) is exported from `template.ts` for
use by future expression resolution code. It carries the `expression` string
and optional `nodeName` so callers can surface actionable diagnostics. In
Phase 1, missing paths resolve as empty strings (Handlebars default) —
`ExpressionError` is reserved for structural errors detected before
compilation.

Regression tests lock this posture in `template.test.ts`: proto chains, global
probes, legitimate own-property resolution, and the full `$`-prefixed context
surface are asserted against every upgrade of Handlebars.

### AF-M9-07 amendment: expression helper set and the unescaped-JSON rule

The n8n → AutoFlow port (M9) adds a fixed helper set and makes raw-JSON output
deliberate. A canonical list, `EXPRESSION_HELPERS`, is exported from
`src/features/executions/template.ts` and is the single source of truth shared
by runtime registration and graph validation.

| Helper | Behavior | Failure path |
|---|---|---|
| `default a b` | `a` when present (non-null, non-empty), else `b` | none |
| `get obj "a.b.0.c"` | Dotted/array path into `obj`; missing → `""` | non-string path throws |
| `json v` | Pretty-printed JSON of own properties (SafeString) | none |
| `eq`/`ne`/`gt`/`gte`/`lt`/`lte` | Comparisons (numeric when both finite, else string) | none |
| `and`/`or`/`not` | Truthiness logic (drops Handlebars' `options` arg) | none |
| `add`/`sub`/`mul`/`div` | Arithmetic; `div` by zero throws | division by zero |
| `len v` | Length of string/array/object keys; missing → `0` | none |
| `upper`/`lower` | Case transform | non-string throws |
| `formatDate d "fmt"` | date-fns format of ISO string / Date / epoch | unparseable throws |

**Unescaped-JSON rule:** by default Handlebars HTML-escapes output. The *only*
supported way to emit raw, unescaped JSON is the triple-stache + `json` helper
(`{{{json v}}}`) — that is documented in `docs/nodes/expressions.md`. Every
node that writes a JSON body (HTTP request, webhook-out, and any future
JSON-body node) validates the compiled result still parses as JSON, so a
malformed template is a config error, not a silent body substitution.

**Unknown-top-level-root validation:** at save time the shared graph validator
(`src/engine/validate.ts` → `checkTemplateRoots`) infers every root the graph
can produce — always-present context keys (`$json`/`$node`/`$execution`/
`$workflow`/`$now`), every node's `variableName`, every SET mapping key
(first dot segment), and the trigger's seeded keys (webhook → `webhook`;
manual → `trigger`) — and emits a **warning** when a config template
references a root outside that union. A ported n8n expression like
`{{$json.body.x}}` or `{{body.x}}` therefore fails loudly at save instead of
silently rendering `""`. `getTemplateRoots` parses with `Handlebars.parse` and
walks the AST (helper callees and `@data` refs are not data roots), so no
template is ever compiled or executed during validation.

## Consequences

- **Positive:** no migration cost for existing workflows; full Handlebars
  feature set retained; single choke point for future policy changes (e.g.
  allow-listing helpers). Templates can now reference upstream nodes by name
  (`{{$node.[Slack].messageContent}}`) without the engine needing a custom
  expression parser.
- **Negative / residual risk:** templates can still read *everything inside the
  data context* — which includes decrypted credential-derived values placed by
  the engine. That is by design (templates interpolate workflow data), but it
  means node authors effectively control what their node's output contains.
  Template *compilation* cost per run remains (acceptable at Phase 1 volumes).
- **Not covered here:** SSRF on outbound URLs (AF-A-02, shipped alongside this
  ADR via `egress-guard.ts`); the full expression resolver may replace or subset
  this implementation entirely in a later milestone.

## Verification

- `npm test` — `template.test.ts` denies 9 proto-chain templates and 3 global
  probes while passing legitimate interpolation. 15 new tests cover the
  `$`-prefixed context surface (`buildTemplateContext`, `$json`, `$node`,
  `$execution`, `$workflow`, `$now`, missing node, `ExpressionError`).
- Manual probe (2026-08-24, handlebars 4.7.8): `{{constructor.name}}`,
  `{{this.constructor.prototype}}`, `{{__proto__}}`,
  `{{a.__proto__.constructor}}`, `{{process.env.PATH}}`, `{{globalThis}}` all
  render `""`; `{{user.toString}}` logs the upstream "access denied" warning
  and renders `""`.
