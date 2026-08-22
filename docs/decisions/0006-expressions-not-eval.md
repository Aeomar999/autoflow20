# 0006 — Expressions are parsed, not evaluated

**Status:** Accepted
**Date:** 2026-08-02
**Deciders:** Engineering

## Context

Workflows need dynamic values: a Slack message containing the email from a previous HTTP call, a URL built from trigger data. The standard solution is a template expression in config, e.g. `{{ $node["Fetch"].json.email }}`.

The tempting implementation is to evaluate the expression body as JavaScript — it is a few lines, and it gives users arbitrary computation for free. n8n does approximately this, and its expression language is one of the things power users like.

The problem: expression bodies are user-supplied strings that run on our servers with our process's privileges, in a multi-tenant system holding every customer's credentials. `eval`, `new Function`, and Node's `vm` module all execute in the same isolate and have well-known escape techniques. `vm2` — the library most often reached for — was abandoned after repeated sandbox escapes.

The market analysis also notes that n8n's expression syntax being "unintuitive" and requiring JavaScript is a *gap to exploit*, not a feature to copy.

## Decision

Expressions are **parsed into a path and resolved against a context object.** No `eval`, no `new Function`, no `vm`, anywhere on the request or execution path.

Supported forms are enumerated in `docs/architecture/execution_engine.md` §5: `$json`, `$items[n]`, `$node["Name"]`, `$execution`, `$workflow`, `$env` (allowlisted), `$now`.

Arbitrary computation is a **separate, sandboxed Code node**, deferred to Phase 2+, with its own isolation design (`docs/architecture/security.md` §6). Acceptable implementations there: a separate hardened service with per-execution containers, or a WASM runtime with no host bindings. `vm`/`vm2`/`isolated-vm` in the main process is explicitly unacceptable.

An unresolvable path throws a named `ExpressionError` identifying the node, field, and expression. It never silently resolves to `undefined`.

## Consequences

**Buys us**
- The most severe threat in the system (T5: RCE) is closed by construction rather than by a sandbox we would have to keep ahead of attackers.
- Expressions are statically analyzable: we can validate them in the editor, autocomplete available paths, and show which upstream fields exist.
- Deterministic and side-effect-free, so resolution is safe to run in the editor for previews.
- The limited surface is simpler for the non-technical users the product explicitly targets.

**Costs**
- No arithmetic, string manipulation, conditionals, or date formatting inside expressions. Users who need those wait for the Code node, or use a `core.set`/transform node.
- We will get feature requests to "just allow JavaScript." The answer is the Code node with real isolation, not loosening this.
- Common transformations must be provided as nodes or as a curated function allowlist (a possible additive extension: `{{ upper($json.name) }}` against a registry of pure, audited functions).

**Forecloses**
- Copy-paste compatibility with n8n expressions. Workflow migration tooling will need to translate, and some expressions will require a node instead.

## Alternatives considered

**`new Function` with a restricted scope object.** Rejected: prototype-chain and constructor escapes are trivial (`({}).constructor.constructor("return process")()`). Scope restriction is not isolation.

**`vm2`.** Rejected: unmaintained after repeated critical sandbox escapes. Using it would be knowingly shipping a known-vulnerable component.

**`isolated-vm`.** Genuine V8 isolate separation and materially stronger. Rejected for expressions: native dependency, real memory and startup cost per evaluation, and it is far more machinery than resolving a path needs. Reconsider for the Phase 2 Code node alongside container and WASM options.

**A full sandboxed expression language (JSONata, CEL, Jsonnet).** A reasonable middle path — CEL in particular is designed for exactly this. Rejected for now on grounds of user-facing complexity and bundle cost for a v1 that mostly needs field references. **Revisit with a new ADR if the function allowlist starts growing without bound** — that is the signal that we are reimplementing a language badly.

## Follow-up

- `AF-M2-03` must include a test asserting that an injection attempt (`{{ constructor.constructor('return 1')() }}`) is inert.
- Any proposal to add computation to expressions requires a new ADR superseding this one.
