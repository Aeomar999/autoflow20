# ADR-0007: Handlebars runtime compilation stays; access is sandboxed

**Status:** Accepted · **Date:** 2026-08-24
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

Regression tests lock this posture in `template.test.ts`: proto chains, global
probes, and legitimate own-property resolution are asserted against every
upgrade of Handlebars.

## Consequences

- **Positive:** no migration cost for existing workflows; full Handlebars
  feature set retained until M2-03 re-evaluates expressions; single choke point
  for future policy changes (e.g. allow-listing helpers).
- **Negative / residual risk:** templates can still read *everything inside the
  data context* — which includes decrypted credential-derived values placed by
  the engine. That is by design (templates interpolate workflow data), but it
  means node authors effectively control what their node's output contains.
  Template *compilation* cost per run remains (acceptable at Phase 1 volumes).
- **Not covered here:** SSRF on outbound URLs (AF-A-02, shipped alongside this
  ADR via `egress-guard.ts`); the M2-03 resolver may replace or subset this
  implementation entirely.

## Verification

- `npm test` — `template.test.ts` denies 9 proto-chain templates and 3 global
  probes while passing legitimate interpolation.
- Manual probe (2026-08-24, handlebars 4.7.8): `{{constructor.name}}`,
  `{{this.constructor.prototype}}`, `{{__proto__}}`,
  `{{a.__proto__.constructor}}`, `{{process.env.PATH}}`, `{{globalThis}}` all
  render `""`; `{{user.toString}}` logs the upstream "access denied" warning
  and renders `""`.
