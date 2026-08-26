# Inngest Setup Manual (AutoFlow)

Operator's guide for configuring Inngest — the durable execution runtime that
runs every workflow — for this project specifically. Written against the code
as it stands today (2026-08-26): `inngest` **3.44.x**, `@inngest/realtime`
**0.4.x**, `inngest-cli` **1.12.x** (dev dependency).

> Scope note: this covers the *execution engine* (running workflows) and its
> realtime status streaming. Webhook ingress for triggers (Stripe/Google
> Forms) is related but separate — those routes call *into* Inngest; see
> `docs/operations/environment_setup.md` §5.7 and §7 for the provider side.
> Engine design rationale lives in `docs/architecture/execution_engine.md`
> (note: that spec describes target-state concepts like compile/validate
> stages and concurrency keys; the implemented runner is simpler — see §2
> here for what actually exists).

---

## Table of contents

1. [TL;DR — quick start](#1-tldr--quick-start)
2. [How Inngest is used in AutoFlow](#2-how-inngest-is-used-in-autoflow)
3. [Part A — Local development (zero config)](#3-part-a--local-development-zero-config)
4. [Part B — Verify end to end](#4-part-b--verify-end-to-end)
5. [The realtime subsystem](#5-the-realtime-subsystem)
6. [Env var reference](#6-env-var-reference)
7. [Retry & failure semantics](#7-retry--failure-semantics)
8. [Part C — Production (Inngest Cloud)](#8-part-c--production-inngest-cloud)
9. [Not wired yet (honest gaps)](#9-not-wired-yet-honest-gaps)
10. [Troubleshooting matrix](#10-troubleshooting-matrix)
11. [Reference links](#11-reference-links)

---

## 1. TL;DR — quick start

| Environment | What you need |
|---|---|
| **Local dev** | Nothing. `npm run dev:all` starts the Inngest Dev Server alongside Next.js. Zero env vars. |
| **Production** | Two secrets from Inngest Cloud (`INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`) + a one-time sync URL registration. |

Local checklist (10 minutes):

1. `npm ci` · start Postgres · `.env` with the four required core values
   (`environment_setup.md` §6 if starting from zero).
2. Run `npm run dev:all`. Three panes open: `next` (:3000), `inngest`
   (:8288), `ngrok` (exits immediately until `NGROK_URL` is set — that pane
   failing is normal).
3. Open http://localhost:8288 — the Dev Server auto-discovers
   `http://localhost:3000/api/inngest` and lists **one function**:
   app **`nodebase`** → function **`execute-workflow`**.
4. Smoke test per §4.

---

## 2. How Inngest is used in AutoFlow

### 2.1 Architecture at a glance

```
 PRODUCERS (send events)              INNGEST                    CONSUMER (this app)
 ───────────────────────              ───────                    ───────────────────
 tRPC workflows.execute    ─┐
   (Run button)             │       ┌──────────────┐    GET/POST/PUT /api/inngest
                            ├─────▶ │  queue +     │ ◀───────────────────────────
 Stripe webhook route       │       │  retries     │   serve({client, functions})
   /api/webhooks/stripe     │       └──────┬───────┘          │
                            │              │ dispatch          ▼
 Google Form webhook route  │              │            execute-workflow fn
   /api/webhooks/google-form│              ▼            src/inngest/functions.ts
                            │       Realtime publish ────┘ (per-node status)
                            ▼                                     ▼
                     Postgres: Execution + NodeExecution rows
```

All three producers funnel through one helper:

```ts
// src/inngest/utils.ts
inngest.send({
  name: "workflows/execute.workflow",
  data: { workflowId, initialData? },
  id: createId(),          // ← cuid2; becomes the dedupe key (§7)
});
```

### 2.2 File-by-file reference

| File | Role |
|---|---|
| `src/inngest/client.ts` | Shared `Inngest` instance. App id `"nodebase"` + `realtimeMiddleware()` (required for channels/publish) |
| `src/inngest/functions.ts` | **The entire engine**: `createFunction("execute-workflow")` listening on `workflows/execute.workflow`, attaching all 9 realtime channels |
| `src/inngest/utils.ts` | `topologicalSort()` (deterministic order, cycle detection) and `sendWorkflowExecution()` |
| `src/inngest/config.ts` | `ENGINE_RETRIES` (default 3, env-overridable 0–20), `truncateStack` (8 KB cap) |
| `src/inngest/trace.ts` | Pure helpers building `NodeExecution` trace rows (incl. SKIPPED rows) |
| `src/inngest/channels/*.ts` | 9 typed realtime channels — one per node type — each exposing one `status` topic `{ nodeId, status: loading\|success\|error }` |
| `src/app/api/inngest/route.ts` | `serve()` handler: Inngest ↔ app handshake + function invocation endpoint |
| Producers: `features/workflows/server/routers.ts:16` (`execute` mutation), `app/api/webhooks/stripe/route.ts`, `app/api/webhooks/google-form/route.ts` | Call `sendWorkflowExecution` |
| UI consumers: `features/executions/hooks/use-node-status.ts` + each node's `actions.ts` server action | Subscribe to realtime status per canvas node |

### 2.3 Function anatomy (what a run actually does)

`executeWorkflow` is step-based: every side effect below is memoized by
Inngest and never re-runs on retry/replay.

```
event: { id (cuid2), data: { workflowId, initialData? } }

1. create-execution      → INSERT Execution row (keyed by inngestEventId @unique)
2. prepare-workflow      → load nodes+connections, topologicalSort
                           (cycle → throw → run fails)
3. find-user-id          → resolve owner for credential access
4. per node, topo order:
     trace-start:<id>    → delete stale FAILED row from a prior attempt,
                           insert RUNNING NodeExecution row (attempt # recorded)
     <executor>          → the node's real work (HTTP/AI/Discord/…);
                           publishes realtime status around itself
     trace-end:<id>      → mark SUCCESS + duration
   on failure:
     trace-fail:<id>     → mark FAILED + error + duration
     trace-skip-remaining→ insert SKIPPED rows for everything downstream
     throw               → Inngest retries the whole function (§7)
5. update-execution      → mark Execution SUCCESS, store output context
onFailure handler        → retries exhausted: Execution FAILED + message +
                           stack truncated to 8 KB
```

Two properties worth internalizing:

- **No silent skips:** every node ends in a terminal state — including
  `SKIPPED` with a reason — so the Executions UI always accounts for the
  full graph.
- **Crash-resumable:** process death mid-run resumes at the last completed
  step; completed node side effects are not repeated. This is why each DB
  write is its own `step.run`.

### 2.4 The event payload contract

```ts
name:  "workflows/execute.workflow"
data:  { workflowId: string; initialData?: Record<string, unknown> }
id:    createId()   // app-generated event id
```

- Trigger producers populate `initialData` (e.g. the Stripe webhook injects
  `{ stripe: { eventId, eventType, timestamp, livemode, raw } }`); it seeds
  the context passed node-to-node.
- The custom event `id` doubles as `Execution.inngestEventId` (**unique**
  column) — redeliveries/replays of the same event can never create a second
  Execution row. Never change this contract casually.

---

## 3. Part A — Local development (zero config)

The Dev Server needs **no keys, no account, no network**. It is a
single-binary stand-in for Inngest Cloud with a full dashboard UI.

1. **Start the stack** — `npm run dev:all` (mprocs runs three panes,
   see `mprocs.yaml`):

   | Pane | Command | Where |
   |---|---|---|
   | `next` | `next dev --turbopack` | http://localhost:3000 |
   | `inngest` | `inngest-cli dev` | http://localhost:8288 |
   | `ngrok` | `npm run ngrok:dev` | exits instantly unless `NGROK_URL` set (expected, not an error) |

2. **Discovery handshake.** `inngest-cli dev` probes
   `http://localhost:3000/api/inngest` automatically. Within seconds the
   dashboard at :8288 shows the app **nodebase** with exactly one function,
   **execute-workflow**. Non-standard port? Point it manually:
   `npx inngest-cli dev -u http://localhost:<port>/api/inngest`.

3. **Why nothing else is needed locally:** `INNGEST_EVENT_KEY` /
   `INNGEST_SIGNING_KEY` are optional in `src/lib/env.ts`; both
   `inngest.send()` and `serve()` fall back to unauthenticated dev behavior
   against the local Dev Server.

> Running plain `npm run dev` without the Dev Server? The app boots fine but
> the Run button sends events nowhere — always use `dev:all` when touching
> execution features.

---

## 4. Part B — Verify end to end

Each step names what proves it.

1. **Sign up** at `/signup`, land on `/workflows`, create a workflow.
2. **Build a minimal graph:** add a **Manual Trigger** and an
   **HTTP Request** node (URL `https://example.com`), connect them, `Ctrl+S`.
3. **Run it:** click Run on the trigger node.
4. **Three surfaces light up:**
   - **Dev Server UI** (:8288) → Runs tab: a green run for
     `execute-workflow` with the full step timeline (`create-execution`,
     `prepare-workflow`, `trace-start:…`, …). Clicking into a run shows
     event payloads and per-step output — your best debugging surface.
   - **Editor canvas:** the trigger node's ring animates loading→success in
     real time (the §5 realtime subscription working end to end).
   - **Executions page:** run detail shows per-node traces (status,
     duration, attempts) from the `NodeExecution` table.
5. **Exercise failure deliberately:** point HTTP Request at
   `http://localhost:9999` (connection refused) → node goes red, downstream
   nodes appear SKIPPED in the trace, Execution FAILED, Dev Server shows the
   retry schedule (default 3 attempts, §7).
6. **Replay from :8288:** replay a failed run → new attempt starts, **no
   duplicate Execution row** appears (unique `inngestEventId`), and already-
   successful steps don't re-execute their side effects.

---

## 5. The realtime subsystem

Canvas node status pills are not polled — they're pushed over Inngest
Realtime.

```
executor (server, inside a step)          browser (canvas node component)
  publish(status topic) ──▶ Inngest ──▶ useInngestSubscription(token)
                                        token minted by a "use server" action
```

Wiring, piece by piece:

1. **Channels declared once**, typed, in `src/inngest/channels/*.ts`. All
   nine are attached to the function definition in `functions.ts` — this is
   what authorizes `publish` inside executors.
2. **Executors publish** around their work: `loading` before, `success` /
   `error` after (every `features/**/executor.ts` receives `publish` in its
   `NodeExecutionContext`).
3. **Tokens minted server-side only.** Each node component pairs with a
   `"use server"` action calling `getSubscriptionToken(inngest, { channel,
   topics: ["status"] })` (e.g. `manual-trigger/actions.ts`). The browser
   never holds Inngest credentials — only a scoped short-lived token.
4. **Client-side filtering.** `useNodeStatus` subscribes once and picks the
   latest message matching `(channel, topic, nodeId)`.

Operational consequences:

- Realtime works identically against Dev Server and Cloud — no extra config
  either place, because the middleware lives on the shared client and tokens
  are minted through it.
- Adding a new node type: create its channel, attach it to the function's
  `channels:` array, mirror the pattern in `executor.ts` / `node.tsx` /
  `actions.ts`. Forgetting the `channels:` attachment makes `publish` a
  silent no-op — runs still succeed, pills just never move.

---

## 6. Env var reference

All Inngest-related variables are **optional** in the Zod schema
(`src/lib/env.ts:30-31`) — required only outside local dev:

| Variable | Read by | Effect if unset |
|---|---|---|
| `INNGEST_EVENT_KEY` | Inngest SDK, by convention (not referenced in app source) | `inngest.send()` cannot authenticate against Inngest Cloud → producing events fails in production |
| `INNGEST_SIGNING_KEY` | `serve()` at `/api/inngest` | Sync/function-call signatures can't be verified → Cloud refuses to sync or invoke; local dev unaffected |
| `ENGINE_RETRIES` | `src/inngest/config.ts:31` (app-level) | Defaults to `3`. Integer 0–20; anything invalid silently falls back to 3 |
| `NGROK_URL` | `package.json` `ngrok:dev` | Only affects tunneling webhook triggers, not the engine |

Split of responsibilities: `INNGEST_EVENT_KEY` governs **outbound** (app →
Inngest), `INNGEST_SIGNING_KEY` governs **inbound** (Inngest →
`/api/inngest`). A deployment with only one set is half-broken in a
characteristic way (see troubleshooting rows).

---

## 7. Retry & failure semantics

What you will see during incidents, mapped to code:

- **Retries re-invoke the entire function.** With `retries: 3` (default),
  Inngest schedules attempts with backoff. Completed `step.run`s are
  memoized, so attempt N fast-forwards through earlier steps and resumes
  where the previous one failed.
- **Stale state is cleaned, not duplicated.** A previous attempt may leave a
  `FAILED` `NodeExecution` row, so `trace-start:<nodeId>` deletes existing
  rows for that node before inserting a fresh `RUNNING` row with the current
  `attempt` number (`functions.ts:106-124`). The trace shows the latest
  attempt per node plus its attempt counter — not ghost duplicates.
- **Non-retriable misuse fails fast.** Missing event id / workflow id throws
  `NonRetriableError`, which suppresses further retries regardless of budget.
- **Final failure is recorded.** When retries are exhausted, Inngest invokes
  the `onFailure` handler (`functions.ts:27-37`): Execution → `FAILED` with
  message + stack truncated to 8 KB (`MAX_STACK_LENGTH`). The last attempt's
  error also flows through `trace-fail` / `trace-skip-remaining`.
- **Cycles kill the run deterministically.** `topologicalSort` detects a
  cycle in `prepare-workflow`; that step is memoized as failed, so every
  retry fails identically until the graph is fixed.
- **Tuning:** set `ENGINE_RETRIES=0` locally while debugging noisy failing
  nodes; keep the default in production. This is the single retry policy for
  the whole engine (AF-A-07) — per-node policies are spec-stage only.

---

## 8. Part C — Production (Inngest Cloud)

Target stack: Vercel (Next.js-native) + managed Postgres + Inngest Cloud.
Order matters — steps 1–2 before 3.

1. **Create the app in Inngest Cloud** (https://www.inngest.com → app
   dashboard → Keys tab):
   - copy the **Event Key** → `INNGEST_EVENT_KEY`
   - copy the **Signing Key** → `INNGEST_SIGNING_KEY`
2. **Set them on your host** (Vercel project → Environment Variables,
   Production scope) alongside the production env matrix in
   `environment_setup.md` §8.2, then **deploy**. Both keys must exist before
   the first sync attempt.
3. **Register the sync URL.** In the Inngest dashboard add the app with sync
   URL `https://your-domain.com/api/inngest`. Inngest PUTs a signed config
   request; `serve()` verifies and responds with the function manifest.
4. **Confirm the handshake:** the dashboard lists `execute-workflow` under
   app `nodebase`. From here the Run button, Stripe webhooks, and Google
   Form webhooks dispatch through Cloud instead of the Dev Server.
5. **Verify realtime still streams** (canvas rings animate). Cloud realtime
   needs no extra setup; failures usually mean the subscription-token server
   action is erroring — check server logs, not Cloud config.

Notes:

- **No Dockerfile, no worker process.** Functions execute inside the Next.js
  serverless function invoked by Inngest at `/api/inngest`. Long workflows =
  long invocations; Vercel function duration limits apply. Inngest retries
  cover transient kills.
- **Rotating the signing key:** add the new key in Inngest Cloud first,
  update host env, redeploy, then remove the old key. Doing it backwards
  causes 401s on every invocation.
- **Environments:** this project wires a single production app. Don't create
  preview-environment apps pointing at the same database without
  understanding the shared-state blast radius.

---

## 9. Not wired yet (honest gaps)

Documented so nobody assumes otherwise:

- **No concurrency keys / throttling.** The spec's tenant-fairness section
  (`execution_engine.md` §7) is aspirational. A runaway workflow can consume
  unbounded concurrent runs today; mitigation is Polar-gated creation
  (`premiumProcedure`), not engine caps. Wiring Inngest `throttle` /
  `concurrency` on `executeWorkflow` is small, valuable future work.
- **No per-node retry policies, timeouts, or cancellation.** One global
  retry count; no run wall-clock cap yet.
- **No scheduled/cron triggers.** Only manual-run and two webhook producers.
- **No dead-letter alerting beyond `onFailure`'s DB write.** Sentry is
  integrated but not wired to engine failures specifically.

---

## 10. Troubleshooting matrix

| Symptom | Likely cause | Fix |
|---|---|---|
| Dev Server (:8288) shows no apps/functions | Next.js not running, or discovery hasn't fired | Start `dev:all` (order doesn't matter — discovery retries); confirm `http://localhost:3000/api/inngest` returns 200 JSON |
| Run button does nothing; no run in :8288 | Dev Server wasn't up when the event was sent (plain `npm run dev`) | Use `npm run dev:all`; check Network tab for the tRPC `execute` mutation result |
| Production: event-send errors (auth/401-style) on Run/webhook | `INNGEST_EVENT_KEY` missing/wrong on host | Add key, redeploy (§8 step 2) |
| Production: Cloud sync fails / functions never invoke | `INNGEST_SIGNING_KEY` missing/mismatched, or wrong sync URL | Re-copy signing key → host env → redeploy; URL must be exactly `https://your-domain.com/api/inngest` |
| Worked in dev, broke after key rotation | Rotation done backwards | Follow §8 rotation order |
| Run stuck "In progress" forever in dev | Laptop slept mid-run / Dev Server closed while queued | Replay the run from :8288 |
| Every retry fails identically at `prepare-workflow` | Graph contains a cycle (old data or direct DB edits) | Fix the graph; the editor prevents saving cycles |
| Node trace stuck RUNNING forever, run eventually fails | Executor hung (no per-node timeout exists yet) | Check the target service; :8288 step view shows which step never returned |
| Canvas pills never animate (runs succeed) | Realtime broken: token action erroring, channel not attached in `channels:` array, or name typo | Check server logs for the `*RealtimeToken` actions; verify channel attachment (§5) |
| Duplicate Execution rows for one logical run | Producer bypassed `sendWorkflowExecution` (no cuid2 id ⇒ Inngest mints one per send) | Route all producers through `src/inngest/utils.ts`; true replays are rejected by the unique constraint |
| First prod run 500s: Prisma "table does not exist" | Migrations never applied to prod DB | `DATABASE_URL="<prod>" npx prisma migrate deploy` |

General debugging tip: **the Dev Server UI is ground truth for the engine**
(event payload, step outputs, retry schedule). The Executions page is ground
truth for *recorded outcomes*. If they disagree, trust :8288 first.

---

## 11. Reference links

- Local dev server CLI: https://www.inngest.com/docs/self-hosting/local-dev
- Next.js serving: https://www.inngest.com/docs/frameworks/nextjs
- Step toolkit & memoization: https://www.inngest.com/docs/functions/steps
- Retries & `NonRetriableError`: https://www.inngest.com/docs/functions/retries
- Realtime (channels/topics/subscriptions): https://www.inngest.com/docs/features/realtime
- Inngest Cloud keys: https://www.inngest.com/docs/platform/cloud
- Repo truth sources: `docs/architecture/execution_engine.md` (spec vs impl),
  `docs/operations/environment_setup.md` (§5.6, §6 walkthrough, §7 ngrok,
  §8 deployment), `docs/planning/tasks.md` (engine tasks).

