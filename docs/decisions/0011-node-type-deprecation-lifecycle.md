# ADR-0011: Node types are retired by deprecation, never by deletion

**Status:** Accepted
**Date:** 2026-08-31
**Deciders:** Engineering
**Related:** ADR-0001 (node registry as the core abstraction), AF-M5-09, `docs/architecture/node_sdk.md`

## Context

`AI_LLM` (AF-M5-02) supersedes the three tutorial-era per-provider executors —
`OPENAI`, `ANTHROPIC`, `GEMINI`. Each is pinned to one hard-coded model, none
of which is in the provider registry (`gpt-4`, `claude-sonnet-4-5`,
`gemini-2.0-flash`), so none of them can price a run, capture usage, fall back
to a second model, or return JSON. AF-M5-09 retires them.

`Node.type` is persisted, and `docs/architecture/node_sdk.md` is explicit that
it is permanent: a saved workflow stores the type id, and so does every
`WorkflowVersion.graphSnapshot` and `Execution.graphSnapshot`. Deleting a
registration therefore has effects far beyond the palette:

- `nodeRegistry.resolve()` throws `UnknownNodeTypeError`, so `validate()`
  fails the whole graph — a workflow that ran yesterday stops running.
- The version list and the run history cannot render a node they cannot
  resolve, so published history breaks too.
- The failure lands at execution time, on a customer's workflow, not at
  deploy time on ours.

The `INITIAL` → `MANUAL_TRIGGER` retirement (AF-M1-02) already established the
shape of the answer — keep the old id resolvable, migrate the rows — but it
solved it with a registry alias, which only works when the two types share a
config shape. These three do not: `credentialId` has to become
`openaiCredentialId` / `anthropicCredentialId` / `geminiCredentialId`, and a
model id has to be chosen. An alias alone would resolve the type and then fail
at run time with "credential required", which is a silent breakage wearing a
working node's clothes.

## Decision

Retiring a node type is a three-step lifecycle, not an edit.

1. **Deprecate.** The definition gains
   `deprecated: { since, replacedBy, reason }` (`NodeDefinition.deprecated`,
   `src/nodes/types.ts`). The type stays in `nodeManifest` and in
   `nodeRegistry` with its `execute` intact, so every saved workflow, published
   version, and historical trace keeps resolving and running. `nodeManifest`
   also exports `nodePalette` — the same list minus deprecated entries — and
   the node selector reads *that*, so no new instance can be created. The
   population can only shrink. The config panel renders the deprecation notice
   and names the replacement.

2. **Migrate.** A pure, isomorphic mapper (`src/nodes/ai/legacy-migration.ts`)
   rewrites one node's config onto the replacement and validates the result
   against the replacement's own `configSchema`. An idempotent script
   (`npm run migrate:legacy-ai-nodes`, dry-run by default) applies it to live
   `Node` rows, printing every change — including the model substitution and
   any undeclared config key it dropped. Keys prefixed `_` (`_timeoutMs`,
   `_continueOnFail`) are engine-level and carried through verbatim.

3. **Remove.** Deleting the folder is a separate, later task, taken only once
   no persisted `Node` row of that type remains in any environment. It is not
   part of AF-M5-09.

**Snapshots are not rewritten.** `WorkflowVersion.graphSnapshot` and
`Execution.graphSnapshot` are history: version 3 recorded what version 3 was,
and a trace recorded what actually ran. Rewriting either would make the version
diff and the run history lie about the past. They keep resolving through the
still-registered deprecated definition, which is exactly why step 3 waits.

**The model substitution is explicit, not silent.** Each legacy node moves to
the nearest *registered* model of the same provider — `openai:gpt-4o`,
`anthropic:claude-3-5-sonnet`, `google:gemini-1.5-flash` — because the
hard-coded originals cannot be priced. This changes behaviour, so the script
prints every substitution and the dry run is the default.

## Consequences

- No saved workflow breaks when a node type is retired, and the breakage class
  that would have been discovered at run time cannot occur.
- Retirement becomes reviewable: `deprecated` is data on the definition, so
  tests assert the invariants generically (deprecated types stay executable;
  the palette never offers one; every `replacedBy` points at a live type).
- The cost is a tail: deprecated code lives on until the migration has run
  everywhere. That is deliberate — the alternative trades a maintenance cost we
  control for a customer-visible failure we do not.
- Config migration is per-retirement work. `NodeDefinition.migrate` handles
  version bumps within one type; it cannot express a type change, so a mapper
  module is written per retirement.

## Alternatives considered

**Delete the three node folders.** Cheapest to write, and it breaks every saved
workflow still holding one — at execution time, on someone else's workflow.
Rejected outright.

**Registry alias `OPENAI → AI_LLM`.** Works for `INITIAL → MANUAL_TRIGGER`
because the config shapes match. Here the credential key and model must both
change, so the node would resolve and then fail with "credential required" —
a silent failure, our top-priority defect class (engineering_rules §2).

**Rewrite the graph snapshots too.** Would let the definitions be deleted
immediately, at the price of falsifying published versions and run history.
A version list that no longer matches what was published is worse than
carrying three deprecated folders.

**Migrate inside a SQL migration.** `Node.data` is JSON and the mapping is
conditional per type; expressing it in SQL is both harder to review and
impossible to dry-run. `docs/architecture/data_model.md` §4 already says
backfills are idempotent, resumable scripts, not inline migration steps.
