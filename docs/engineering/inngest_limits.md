# Inngest limits, and what they mean for this engine

**Status:** Built (AF-M2-00), from **published limits**. See §7 for the one number that is still unmeasured.
**Read before:** raising a node timeout, adding a step to the engine loop, or telling anyone how large a workflow can be.
**Companions:** `docs/decisions/0002-inngest-as-execution-runtime.md`, `docs/decisions/0018-bounded-node-output-over-blob-spill.md`.

AF-M2-00 was written as a spike to run **before** designing around Inngest. It did not happen, and M2 shipped anyway. So this document is retrospective, and its value is not the limit table — it is §5, which compares the limits against what `src/inngest/functions.ts` actually does.

The short version: **the 1000-step ceiling is not the constraint anyone will hit.** The engine's rolling context makes run state grow with the square of the node count, and that binds first, at graph sizes people will plausibly build.

---

## 1. The published limits

From Inngest's usage-limits documentation, checked 2026-09-02 against `inngest@3.54.2`.

| Limit | Value | Varies by plan? |
|---|---|---|
| Step-returned payload | **4 MiB** | no |
| Function run state (total) | **32 MB** | no |
| Steps per function run | **1000** | no |
| Event payload | 256 KiB Free · 512 KiB Basic · 3 MiB Pro | **yes** |
| Concurrent steps | 5 Free · 25 Basic · 200+ Pro | **yes** |
| Function run duration | 30 days Free · 90 Basic · 366 Pro | **yes** |
| Batch size | 10 MiB hard cap | no |

"Function run state" is the one to internalise: it counts **event data, every step's return value, the function's return, and metadata, added together** for the whole run. It is not a per-step figure.

---

## 2. Step payload size

Two separate caps apply, and they are not the same number:

- **4 MiB** for any single step's return value.
- **32 MB** for everything the run retains, summed.

A run can therefore die from many medium steps as easily as from one enormous one. See §5 — that is exactly how this engine fails.

## 3. Max steps per function

**1000.** Inngest's own documentation warns that a loop creating one step per item "can hit this quickly", which is precisely the shape of `executeWorkflow`: it loops over sorted nodes and opens steps per node (§5.1).

## 4. Concurrency keys, cancellation, cron, local-dev parity

**Concurrency keys — used, and correctly.** `executeWorkflow` declares two:

```
{ key: "event.data.workflowId", limit: 1 }
{ key: "event.data.organizationId || event.data.userId || event.data.workflowId", limit: 10 }
```

The first serialises runs of the same workflow, so a workflow cannot race itself. The second caps a tenant at 10 concurrent runs, which is what stops one organisation starving the others. The `||` fallback chain matters: an event missing `organizationId` still gets bucketed rather than falling into a shared default key.

The five cron functions (`ai-cache`, `cron`, `knowledge`, `notifications`, `oauth-refresh`, `retention`) each declare `concurrency: { limit: 1 }`, so a slow sweep cannot overlap itself.

**Note the plan interaction:** concurrent *steps* are capped at 5 on Free. The per-tenant limit of 10 concurrent runs is therefore not reachable on a Free Inngest account — the account-level step concurrency binds first. The engine's limits assume Basic or above.

**Cancellation — not used.** No function declares `cancelOn`, and nothing calls Inngest's cancellation API. `POST /api/v1/executions/:id/cancel` (AF-M8-01) marks the row cancelled in the database; it does not stop the Inngest run, which continues to completion. Steps already memoised still cost money and still write traces. This is a real gap, not a documentation nuance.

**Cron — used for schedules, and for the trigger sweep.** `src/inngest/cron.ts` runs `* * * * *` and evaluates each workflow's own cron expression with `cron-parser`. So schedule granularity is one minute regardless of what a user writes, and a workflow scheduled more finely than that silently runs at most once a minute.

**Local-dev parity.** `inngest-cli dev` ships as a devDependency and `npm run dev:all` starts it alongside Next. The dev server does **not** enforce the plan-dependent limits above — event payload size, step concurrency, and run duration are effectively unbounded locally. A workflow that works on a laptop can therefore fail in production on limits the laptop never applied. Nothing in the repository currently checks this.

---

## 5. What this engine actually does — the part that matters

### 5.1 Steps per node

`executeWorkflow` opens **four steps per node** on the happy path:

| Step | Line |
|---|---|
| `trace-start:<nodeId>` | ~492 |
| `resolve-credentials:<nodeId>` — unconditional, even for nodes needing none | ~525 |
| `node:<nodeId>:attempt:<n>` | ~548 |
| `trace-end:<nodeId>` / `trace-fail:<nodeId>` | ~607 / ~641 |

Plus about six fixed steps per run (quota gate, create execution, sort graph, resolve ids, update execution, notify). Retries add a step per extra attempt and a `step.sleep` between them, so a node that exhausts its retries costs roughly twice a healthy one.

**Ceiling from step count alone: ~248 nodes.** That is generous, and it is not what will stop you.

### 5.2 The rolling context makes state quadratic

**18 of 21 node executors return `{ ...context, <their own output> }`.** Every node's step return therefore contains the entire accumulated output of every node before it.

Inngest memoises every step return. So for `n` nodes each adding `b` bytes, the run retains roughly

```
b × (1 + 2 + … + n)  =  b × n(n+1)/2
```

— quadratic, against a 32 MB cap. And since each individual return carries the whole context, the context itself must also stay under the 4 MiB per-step cap.

**Node ceilings, derived from the published caps:**

| Output added per node | 4 MiB step cap | 32 MB state cap | 1000-step cap | **Binds first** |
|---|---|---|---|---|
| 1 KB | 4096 | 249 | 248 | step count — **248 nodes** |
| 10 KB | 409 | 78 | 248 | run state — **78 nodes** |
| 100 KB | 40 | 24 | 248 | run state — **24 nodes** |
| 1 MB | 4 | 7 | 248 | step output — **4 nodes** |
| 4 MB | 1 | 3 | 248 | step output — **1 node** |

100 KB per node is not a pathological number — it is one ordinary HTTP node returning a JSON list, or one AI node returning a long completion. **At that size the engine tops out around two dozen nodes**, roughly a tenth of what the step ceiling suggests.

### 5.3 Nothing bounds node output

The only truncation anywhere in the engine is `MAX_STACK_LENGTH = 8_000` for stack traces (`src/inngest/config.ts`). Node outputs are not bounded, sampled, or measured. An HTTP node fetching a 5 MB response exceeds the 4 MiB step cap on its own, and the failure surfaces as an Inngest error about state size rather than as "your HTTP node returned too much data".

### 5.4 Consequences already visible in the backlog

M9 plans `AF-M9-12` "Branch isolation: resolve each node's input from its incoming edges" and `AF-M9-05` "Stop leaking `$json`/`$node` into node output and traces". Both were motivated by correctness, not capacity — but replacing the single rolling context with per-node input resolution is also **the fix for the quadratic term**, and it is worth more headroom than any payload optimisation done on top of the current design.

---

## 6. What to do about it

Recorded as **ADR-0018**. In short: bound node output at a threshold that fails loudly, and fix the rolling context rather than adding blob-spill underneath it.

---

## 7. The gap: this is derived, not measured

Every number in §5 is arithmetic over Inngest's *published* limits. None of it has been observed against a real Inngest account, which the original acceptance criterion asked for. Specifically unverified:

- Whether the 32 MB state figure counts raw JSON bytes, compressed bytes, or an internal encoding — the node ceilings move with this.
- Whether the dev server enforces anything at all (§4 assumes it does not).
- What the failure actually looks like: which error surfaces, at which step, and whether the partial trace survives.

**To close it**, run a workflow of `n` HTTP nodes each returning a known payload size against a real account, increase until it fails, and record the node count and the error in this section. That measurement is what turns this document from arithmetic into evidence — and it is cheap, once there is a deployed environment to run it in.
