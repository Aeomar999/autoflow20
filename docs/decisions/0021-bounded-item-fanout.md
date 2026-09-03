# 0021 - Bounded item fan-out (SPLIT_OUT → segment → AGGREGATE)

**Status:** Accepted (AF-M9-14); implemented 2026-09-03 in `src/engine/` and `src/nodes/core/`.
**Companion:** `docs/architecture/execution_engine.md` §3.2, §4; ADR-0018 (output bound), ADR-0019 (per-node input).

## Context

W3 (`api-etl-batch-deliver`) must deliver one record per external object. The first cut of the fan-out milestone (ADR-0019, G5) gives branch *isolation* but not *repetition*: the runner is linear and executes each node exactly once in topological order. There is no way to run a sub-graph once per element of an array.

n8n solves this with a split-in-batches node that wraps a segment and re-executes it with a per-item scope. That design has properties AutoFlow explicitly does not want to inherit untested: unbounded `repN` loops, in-segment `Wait` / resumable batch cursors, and nesting of iterators. This ADR bounds the feature to the one shape the W3 delivery actually needs.

The task (AF-M9-14) fixes the fallback up front: if this is not green by week 5, W3 ships as **one batched POST carrying all ten records** and the split/aggregate nodes move to Phase 2. That fallback is preserved as the deliberate escape hatch; the decision here is the bounded shape that makes the non-fallback path correct.

## Decision

**1. Two new TRANSFORM nodes, `SPLIT_OUT` and `AGGREGATE`, define a fan-out segment.**

- **`SPLIT_OUT`** reads an array at a configured dot-path in its resolved input (`buildNodeInput`, ADR-0019), validates it is an array, and produces one output object `{ items: unknown[], count: number }`. It does not itself iterate — it is the *open* of the segment.
- **`AGGREGATE`** closes the segment. After every interior node runs once per item, it returns `{ items: unknown[], count, failed: string[] }`: the per-item outputs the interior produced (or the item itself when the interior produced nothing), the number of items, and the indices/names of items that failed. Downstream of the AGGREGATE, `context`/`nodeOutputs` carry this aggregated object, so the graph continues linearly.

**2. The segment is a contiguous, non-nested, non-crossing sub-graph.**

`src/engine/validate.ts` enforces the shape **at save time, as errors** (never warnings):

- Every `SPLIT_OUT` has **exactly one** reachable `AGGREGATE`, and every `AGGREGATE` has exactly one `SPLIT_OUT` (they pair 1:1).
- **No nesting:** no `SPLIT_OUT`/`AGGREGATE` pair may contain another pair. A segment's interior (everything structurally between its split and its aggregate) must contain no `SPLIT_OUT`/`AGGREGATE` nodes.
- **No crossing edges:** no edge may enter or leave a segment except from the `SPLIT_OUT`'s output to the first interior node, and from the last interior node (or the split, for an empty interior) to the `AGGREGATE`. An edge that connects a node inside the segment to a node outside it (or vice versa) is an error.

Because nesting is rejected, segments are structurally disjoint and the execution order is a simple linear sequence: split → interior (per item) → aggregate → rest of graph.

**3. The runner executes the interior once per item, sequentially, in-scope.**

`src/engine/*` drives fan-out. For each item, indexed 0..N-1:

- Each interior node runs with `$item` = the current item and `$itemIndex` = its index in scope (added to the template resolver alongside `$json`/`$node`/`$execution`/`$workflow`/`$now`). The edge-derived input (ADR-0019) is merged over the per-item scope: `$item`/`$itemIndex` are the highest-precedence keys, everything else resolves as in a plain segment.
- Iteration is **strictly sequential** — one item fully completes (or fails per item policy) before the next starts. Concurrency is out of scope (mirrors ADR-0019's stance; the W3 payload is ten records, sequential is more than fast enough and far easier to trace).
- **Per-node retry and `continueOnFail` are honored inside the segment**, exactly as in the top-level loop. A failing item with `continueOnFail` on the failing node records a `failed` entry (with the error) rather than aborting the run; a failing item without it aborts the whole run (the segment is re-run from its start on the next attempt).
- Splitting an empty array produces zero interior iterations; `AGGREGATE` returns `{ items: [], count: 0, failed: [] }` and the run proceeds. Splitting a non-array (or a missing path) is a hard `SPLIT_OUT` failure — never a silent empty.

**4. Hard cap on fan-out size.**

- Default **100 items per segment** (settable per `SPLIT_OUT` config, 1..1000); engine ceiling of **1000**. A segment whose array is larger than the configured cap — or than 1000 regardless of config — **fails the run** with a clear message naming the node and the cap. It never partially runs and reports success: a run that reports success must have executed every item it claims, or the W3 delivery silently drops records and the next batch is corrupted.
- The cap exists to bound, in one dimension, what ADR-0018 (output bytes) and ADR-0016 (retention rows) bound in the others: an internal segment of K nodes over N items writes K×N trace rows and can return a K×N-sized aggregate.

**5. Tracing — one `NodeExecution` per node per item.**

Each interior node execution over item *i* writes its own `NodeExecution` row carrying an `itemIndex` (new nullable column) so the executions UI can group/per-item the rows. The pre-existing `trace-start` step currently deletes rows for `{executionId, nodeId}` before creating a fresh RUNNING row; for a fan-out that would delete the previous item's finished row. The fan-out path therefore writes rows keyed by `{executionId, nodeId, itemIndex}` and cleans up only that key's prior attempt, so all 10 items' rows survive and the UI shows 10 grouped executions for each interior node. Top-level (non-fanout) nodes set `itemIndex = null` and keep the current single-row-per-node semantics.

**6. Quota and retention accounting — explicit decision.**

Per AF-M7-04 quotas, AF-M7-04 meters one **execution** per *workflow run*. A fan-out does not create additional `Execution` rows — it is one run. So a 100-item segment counts as **one** metered execution for quota. But it writes 100× the `NodeExecution` rows, and ADR-0016 retention deletes `Execution` rows by `createdAt` (cascading `NodeExecution` with them), so the fan-out's row volume is cleaned up with its parent run — no special retention rule. The cost/token sums the execution aggregates are already computed over `NodeExecution`, so a fan-out's aggregate output/tokens are attributed to the single run. This is recorded as the explicit decision the task asked for: **fan-out inflates `NodeExecution` volume but not the metered execution count, and inherits its parent's retention.**

## What remains unsupported (explicitly)

- **Nesting** — a segment inside a segment (rejected at save).
- **Parallel items** — sequential only.
- **`splitInBatches` / resumable batch cursors** — the entire array is split in one pass; no pagination state survives a run.
- **`Wait` inside a segment** — the engine's Wait/loop node is not a legal segment interior node; using one there is rejected at save.
- **Config-driven iteration counts / loops without an explicit array** — `SPLIT_OUT` only iterates a real array value.
- **Per-item credential rotation** — credentials are resolved per node, once, before the fan-out; the same credential used for every item.

## Alternatives considered

**Implement the n8n split-in-batches shape (load-bearing) directly.** Rejected: it drags in nesting, resumable cursors, and in-segment waits that W3 does not need, all untested here, and it complicates the hard-cap and trace-groups this milestone must prove.

**Batched W3 fallback only (one POST, ten records).** Kept as the task's explicit escape hatch if the fan-out is not green by the deadline; it makes the W3 template *correct but not per-object*. The whole point of this ADR is to make the per-object form the shipped one.

**Parallel per-item execution.** Rejected for this milestone: sequential keeps retry/ordering/trace semantics identical to the top-level loop, which is what the tests must prove. Parallelism is a separate later decision and does not change the node contract, the cap, or the trace shape.

## Consequences

- A fan-out is a real, tested engine feature: 10 items → 10 interior iterations and an aggregate of 10; one failing item with `continueOnFail` → 9 succeeded + 1 `failed`; 101 items against a cap of 100 → clean run failure; a nested segment → rejected at save.
- One `Execution` row per run regardless of fan-out width keeps quota semantics simple; `NodeExecution` volume scales with items and is retained with the run.
- The W3 template can ship the per-object form.
