# 0018 - Bound node output; fix the rolling context before adding blob-spill

**Status:** Accepted (AF-M2-00); **implemented (AF-M2-09, 2026-09-02)** — the 1 MiB node-output guardrail is live in `src/inngest/functions.ts` via `MAX_NODE_OUTPUT_BYTES` in `src/inngest/config.ts`. The one number in the table below is still unmeasured — see "The threshold".
**Companion:** `docs/engineering/inngest_limits.md`, which shows the working.

## Context

AF-M2-00 asked for a decision on large-payload handling — **inline vs. blob-spill** — before designing around Inngest. The spike did not run, M2 shipped, and the question is now retrospective. That changes the answer, because there is a built engine to measure against instead of a hypothetical one.

Inngest's published limits: a step return may not exceed **4 MiB**, and a run's total retained state — event data plus every step return plus metadata — may not exceed **32 MB**. Neither varies by plan. Steps per run cap at **1000**.

The engine opens five steps per node (four when this ADR was written; AF-M8-27 added the cancellation read), so the step ceiling allows roughly 198 nodes. That is not the binding constraint, and assuming it was is the mistake this ADR exists to prevent.

**18 of the 21 node executors return `{ ...context, <their own output> }`.** Each node's memoised step return therefore contains every prior node's output. For `n` nodes contributing `b` bytes each, the run retains about `b × n(n+1)/2` — quadratic in node count — while each individual return must still fit under 4 MiB.

What that costs, derived from the published caps:

| Output per node | Node ceiling | Binds on |
|---|---|---|
| 1 KB | 198 | step count |
| 10 KB | 78 | run state |
| **100 KB** | **24** | run state |
| 1 MB | 4 | step output |

100 KB is one ordinary HTTP node returning a JSON list. At that size the engine tops out near two dozen nodes — about a tenth of what the step ceiling implies. Nothing in the engine bounds, samples, or measures node output; the only truncation anywhere is `MAX_STACK_LENGTH = 8_000` for stack traces.

## Decision

**1. Bound node output at the executor boundary, and fail loudly.**

A node whose output exceeds the threshold fails with an error naming the node and the size. It does not truncate silently: a workflow that quietly drops half an API response produces wrong results that look right, which is worse than a failed run. This is the same reasoning as AF-A-04's save-boundary validation and AF-M0-05's no-silent-failures rule.

**2. Do not add blob-spill yet.**

Spilling large payloads to object storage and passing references is the textbook answer, and it is the wrong one to reach for first here. It would sit on top of a design that re-sends the entire context at every step — treating the symptom while the quadratic term stays. It also adds a storage dependency, a lifecycle, and a new way for a run to fail (a reference that outlives its blob) to a system that does not yet have measured evidence it needs any of that.

**3. Fix the rolling context instead — it is worth more than any payload optimisation.**

`AF-M9-12` ("resolve each node's input from its incoming edges") already plans to replace the single rolling context with per-node input resolution, for correctness reasons. It is also the capacity fix: a node's step return would carry its own output rather than everything before it, collapsing `b × n(n+1)/2` back to `b × n`. At 100 KB per node that moves the ceiling from ~24 nodes to the point where the step count binds again — roughly a tenfold gain, from work already scheduled.

**Blob-spill is reconsidered only after that lands**, and only against a measured number.

## The threshold

**Provisional: 1 MiB per node output.**

Derived, not measured. It is a quarter of the 4 MiB per-step cap, which leaves room for the accumulated context travelling alongside the node's own output under the present design, and it is comfortably above what an ordinary API response or model completion produces.

**This number should not be treated as evidence.** It follows from arithmetic over Inngest's published limits, and three things behind it are unverified: whether the 32 MB figure counts raw JSON, compressed bytes, or an internal encoding; whether the dev server enforces any of it; and what the failure actually looks like when it happens. `inngest_limits.md` §7 records how to close that — a workflow of `n` nodes returning a known size, increased until it breaks.

Until then the threshold is a guardrail chosen to be obviously safe, not a tuned value.

## Consequences

- A workflow moving genuinely large payloads will fail at a node with a clear message, instead of dying opaquely on run-state size several nodes later.
- Some workflows that would have squeezed through will now be refused. That is the intended trade: a bound that is occasionally too strict is recoverable, and a run that exceeds Inngest's state cap is not.
- The engine keeps a hard ceiling on graph size until AF-M9-12 lands. It must be documented rather than discovered — `inngest_limits.md` §5.2 is that documentation.
- **Implemented 2026-09-02 under AF-M2-09.** The decision is no longer aspirational: `executeWorkflow` measures the serialized size of every node's executor return and throws a `NonRetriableError` naming the node and the size when it exceeds `MAX_NODE_OUTPUT_BYTES` (`src/inngest/config.ts`, next to `MAX_STACK_LENGTH`). The threshold is deliberately a single named constant, so the measurement from AF-M2-00 changes it in one place. Deciding was the spike's job; building the guardrail with an unmeasured number was deferred on purpose until the decision existed — it now does.

## Alternatives considered

**Blob-spill now.** Rejected above: it preserves the quadratic term and buys a storage dependency to hide it.

**Raise the Inngest plan.** Does not help. The 4 MiB step and 32 MB state caps do not vary by plan — only event payload, step concurrency, and run duration do.

**Truncate instead of failing.** Rejected. Silent truncation turns a capacity problem into a correctness problem, and a workflow that half-processes an API response is harder to diagnose than one that stops.

**Do nothing until it is measured.** Tempting, since the threshold is unmeasured — but the failure mode today is an opaque Inngest state error attributed to no particular node, and the ceiling is low enough (~24 nodes at 100 KB) that a real workflow can reach it. A documented guardrail beats an undocumented cliff.
