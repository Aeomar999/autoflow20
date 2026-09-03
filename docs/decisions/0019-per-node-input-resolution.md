# 0019 - Resolve each node's input from its incoming edges; keep the rolling context as a read-only view

**Status:** Accepted (AF-M9-12); implemented 2026-09-03 in `src/inngest/functions.ts`.
**Companion:** `docs/architecture/execution_engine.md` §3.2, §4, §5 — superseded in part, see below.

## Context

G5 says a fan-out's second branch receives the *first* branch's output as its input. The reason is mechanical: the runner keeps a single `context` variable and does `context = result` after every node, so in `A → (B, C) → D`, node C runs with B's output (B ran just before C in the sequential loop) and D runs with only C's output. Branches are neither parallel nor isolated — they share one mutable bag.

The fix is not parallelism. It is isolation: build each node's input from **what actually feeds it**, i.e. its incoming edges, resolved against the per-node outputs recorded so far. ADR-0018 already anticipated this — bound node output and collapse the quadratic term by having each node's step return carry only its own output. Per-node input resolution is the same decision applied to the *input* side: a node should consume its upstreams' outputs, not a bag that has been mutated by every earlier branch.

A compatibility constraint lands on top: every existing workflow and every seeded catalogue template resolves `{{ $json.field }}` and `$node.[Name].field` against the accumulated input. Changing what a node receives changes what those expressions resolve to. The flat rolling `context` must therefore survive as a read-only view so nothing silently re-points.

## Decision

**1. `nodeOutputs` is the source of truth; each node's input is resolved from its incoming edges.**

`buildNodeInput(node, incoming, nodeOutputs, idToName, fallbackContext)` in `src/inngest/functions.ts`:

- **No incoming edges** (a trigger, or a node at the head of the graph) → receives the `fallbackContext`, which is the run's initial `context` (i.e. `event.data.initialData`).
- **One incoming edge** → that upstream node's recorded output.
- **Several edges into one `main` port** → merged left-to-right in deterministic edge order (later edges overwrite earlier on key collision, because edges keep their persisted order — the merge is a pure function of the stored graph).
- **Several edges across several ports** → keyed by `toInput` port id; each port holds its own merged object. Today every registered node declares a single `main` input port, so this path is implemented but not exercised by real manifests; it is the contract that multi-port nodes will consume.

The `idToName` map is required because edges identify endpoints by `fromNodeId` while `nodeOutputs` is keyed by node *name* (the canvas display name is what templates and `$node.[Name]` reference).

**2. Disabled and continueOnFail nodes still pass input through.**

A disabled node records its resolved input as its `nodeOutputs` entry before skipping, so a successor's edge resolution sees the pass-through value instead of an empty object — the branch is not severed (AF-M9-04 semantics, preserved under edge resolution). A `continueOnFail` failure leaves no output; downstream merges to `{}` rather than inheriting a stale bag. This is a deliberate, documented deviation from the old rolling-context behaviour for that path, tightened by per-node isolation.

**3. The flat rolling `context` is retained as an additional **read-only** view.**

It is still accumulated (`context = result`) and still the `fallbackContext` for no-incoming-edge nodes, but it is **no longer on the critical path** for computing a node's input with incoming edges. Executors receive the edge-derived `nodeInputValue` as their `context`; `buildTemplateContext` (and thus `$json`/`$node`/expression resolution) is built from the same `nodeInputValue`. The compatibility guarantee is that for linear chains the edge-derived input is *identical* to the old rolling bag, so every existing and seeded catalogue template keeps resolving. `docs/architecture/execution_engine.md` is the record of that guarantee.

**4. Execution stays sequential in topological order.** `fan-out` here means *branch isolation*, not *parallelism*. Concurrency is explicitly out of scope for AF-M9-12 — see the task record.

## What this supersedes in `docs/architecture/execution_engine.md`

- **§3.2 (the node loop):** the implicit `context = result` rolling assignment is no longer how a node's input is computed. Each node's input is resolved per its incoming edges. (The engine test for branch isolation — `A → (B, C) → D` — is the behavioural contract; C's input is A's output, not B's, and D receives both.)
- **§4 ("Data model between nodes"):** the statement that a node with multiple incoming connections receives a single flat concatenation in deterministic edge order is now scoped to a *single `main` port*. Across multiple ports the input becomes port-keyed, not flattened.
- **§5 ("Expressions"):** `{{ $json.field }}` "field on the accumulated context (alias for the flat upstream bag)" now resolves against the **per-node** input, not a global bag. For a linear chain the value is unchanged; for a fan-out it is correct per-branch where it was wrong before.

## Consequences

- A node's step return carries its own output; combined with ADR-0018's cap the quadratic run-state growth is gone.
- Branch isolation is now testable and tested: the engine integration suite asserts C receives A's output (not B's) and that a two-edge merge into one port is deterministic across repeated runs.
- The read-only rolling `context` keeps template/compatibility guarantees without reintroducing the bug.
- `continueOnFail` downstream input is now `{}` where the old bag would have leaked the last successful node's output — isolation over inheritance, documented here.

## Alternatives considered

**Keep one rolling `context` and make branches copy-on-write.** Rejected: copying still gives C a snapshot that can't know B is a sibling, not a parent, without an edge walk anyway — the edge walk *is* the correct model.

**Concurrency instead of isolation.** Rejected as the M9 deliverable: parallelism changes failure/retry semantics, ordering guarantees, and the trace, none of which branch isolation requires. Sequencing isolates cleanly with no new race surface; parallelism is a separate, later decision.
