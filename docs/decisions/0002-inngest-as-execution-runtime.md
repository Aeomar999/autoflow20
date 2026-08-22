# 0002 — Inngest as the durable execution runtime

**Status:** Accepted
**Date:** 2026-08-02
**Deciders:** Engineering

## Context

Workflow execution must survive process death, retry individual steps without repeating completed side effects, run on a schedule, enforce per-tenant concurrency, and be cancellable. Those are the mechanics behind the product's central promise — "n8n's power without the DevOps burden."

Building that ourselves means a queue, workers, a scheduler, a dead-letter path, visibility tooling, and the operational burden of all of it. That burden is precisely what we are selling against. Inngest is already installed and wired (`src/inngest/client.ts`, `/api/inngest`), currently running one demo function.

## Decision

Inngest is the durable execution runtime. Each node executes inside `step.run(...)`, so completed nodes are memoized and a resumed run does not re-invoke their side effects.

Inngest also provides: cron for schedule triggers, concurrency keys for per-workflow and per-tenant fairness, cancellation, and retry primitives.

An abstraction seam is kept at `src/engine/` — the engine owns compile, plan, expression resolution, and state recording; Inngest owns durability and scheduling. Engine logic is unit-testable without Inngest.

## Consequences

**Buys us**
- Crash-resumability, retries, cron, and concurrency without operating infrastructure — weeks of work and an ongoing on-call surface avoided.
- Local dev parity via the Inngest dev server (`npm run dev:all`).
- The "zero DevOps" claim is architecturally true, not marketing.

**Costs**
- A vendor on the critical path. An Inngest outage is an AutoFlow execution outage.
- Platform limits (step payload size, steps per function, execution duration) constrain engine design. `AF-M2-00` spikes these **before** the engine is designed around them.
- Self-hosting (Phase 3) requires either self-hosted Inngest or a second runtime behind the seam.

**Forecloses**
- Sub-second scheduling precision and very long-running (hours+) single executions, until limits are confirmed.

## Alternatives considered

**BullMQ/Redis + our own workers.** Rejected: we would build and operate exactly the infrastructure our positioning says customers should not have to. Also adds Redis to the critical path immediately.

**Temporal.** Genuinely stronger durable-execution primitives. Rejected for now: heavy operational footprint (or Temporal Cloud cost) and a much steeper learning curve for a pre-revenue product. Reconsider if step limits become the binding constraint at scale.

**Postgres-backed job table with a polling worker.** Rejected: simple to start, then we slowly rebuild a job system badly — the classic path to an unowned distributed scheduler.

**Vercel cron + serverless functions.** Rejected: no durable step semantics, so a mid-run crash re-executes side effects. That breaks correctness property P2 in `docs/architecture/execution_engine.md`.

## Follow-up

- `AF-M2-00` must document measured limits and record a payload-handling decision (inline vs. blob-spill) before `AF-M2-04`.
- Keep `src/engine/**` free of Inngest imports except in the runner entry point.
