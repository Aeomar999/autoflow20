# 0024 — Polling triggers: at-least-once with dedupe, and no history replay

**Status:** Accepted (AF-M10-05); implemented 2026-09-03 in `src/features/triggers/server/`, `prisma/migrations/20260903140000_add_trigger_state`.
**Companion:** `docs/architecture/execution_engine.md` §Triggers; ADR-0002 (Inngest as execution runtime).

## Context

**18 of M10's 35 reference automations begin with "when a new X appears"** — a new sheet row, a new unread mail, a new file in a Drive folder, a new Airtable record. None of the providers involved offers a webhook that AutoFlow could subscribe to for the shape these automations need, so the answer is polling.

Nothing in the platform could express it. `evaluate-schedules` dispatched whole workflows on a cron and kept no state, so "new since last run" was inexpressible: a five-minute cron either reprocessed everything it found or processed nothing twice by luck.

Three failure modes decided the design, all of them things that happen in production and none of them recoverable after the fact:

1. **History replay on activation.** A user publishes a workflow watching a spreadsheet that already has 500 rows. The naive first poll returns 500 items and starts 500 runs. They find out from their provider's rate limiter, or from 500 emails.
2. **Double dispatch on an overlapping window.** Providers answer "changed since T" *inclusively*, so consecutive polls overlap — usually by an item or two, occasionally by a whole page when a batch shares a timestamp. A cursor alone does not prevent this, and the visible result is two invoices for one order.
3. **A broken credential polled forever.** One expired token, retried every minute, for the rest of the month.

## Decision

**1. `TriggerState`, one row per `(workflowId, nodeId)`, owned entirely by the framework.**

`cursor Json`, `lastSeenIds String[]`, `lastPolledAt`, `failureCount`, `nextPollAt`, `keyFingerprint`, org-scoped with cascade deletes.

A poller **never writes this table**. Its whole contract is `poll({ config, credentials, cursor, isFirstPoll, limit }) → { items, cursor }`. Dispatch, dedupe, cursor persistence and backoff have one implementation, so an off-by-one in "what counts as already handled" is a bug in one file rather than in each of eighteen connectors.

**2. The first poll establishes the baseline and dispatches nothing.**

A trigger with no prior state records the cursor and the ids it saw, and returns zero dispatches. `isFirstPoll` is passed to the poller so it *may* fetch a cheaper "where is the end?" response, but it does not have to: the suppression is the framework's, so a poller that ignores the flag is still safe.

This means an activated workflow never processes history. If a user wants the backlog, that is an explicit backfill action — not the accidental consequence of clicking Publish.

**3. Dedupe by stable item id, not by cursor.**

Each item carries an id that is durable across polls (a row id, a message id, a file id — never an array index). The framework keeps the last **500** dispatched ids per trigger and suppresses anything already in that window, including duplicates repeated *within* one poll.

500 covers ordinary overlap with room for a batch that shares a timestamp, and keeps the row small enough to read on every sweep. An item with no id is dropped rather than dispatched: an item that cannot be deduplicated would be re-run on every poll forever, which is worse than not running it once.

**4. State is persisted before runs are dispatched.**

If the process dies between the write and the dispatch, the items are re-discovered on the next poll and suppressed by the id window — one missed cycle. The other order loses runs on every crash: dispatch, die, and the state write never happens, so the same items dispatch again.

This is what makes the delivery guarantee **at-least-once, deduplicated** rather than exactly-once, which is not available against providers that offer no idempotency key.

**5. A failing poll changes nothing but the backoff.**

Cursor and id window are carried forward untouched, `failureCount` increments, and `nextPollAt` is set to `interval × 2^failures`, capped at one hour. A provider outage costs a delay, never a gap in what gets processed. A missing credential fails the same way and backs off the same way — it is a configuration problem, but retrying it every minute helps nobody.

**6. Budgets, not fairness heuristics.**

At most **50 items dispatched per poll** (a backlog drains over several sweeps) and **200 pollers per sweep**, ordered never-polled-first then oldest-polled-first. One org with 500 triggers cannot starve everyone else's, and a sustained overflow is logged rather than silently dropped.

**7. The sweep extends `evaluate-schedules` rather than adding a second cron.**

Both read the same set of published workflows on the same one-minute tick. A separate job would double that read and let the two drift over what "active" means. They are separate `step.run`s, so a provider outage in a poller cannot make the schedule evaluation look like it failed.

**8. `keyFingerprint` clears the window when identity changes.**

Hashed from the config fields that define what an item *is* — the sheet and range, the Gmail query, the Drive folder — and explicitly not from cosmetic fields. Renaming a node or changing its interval must not clear the dedupe window, because that replays the backlog. Changing the watched sheet must, because the stored ids answer a question the node no longer asks.

## Consequences

**Buys.** 18 automations become expressible. A new poller is ~40 lines and a node folder — it inherits dedupe, cursor persistence, backoff and budgets for free. `TriggerState` also backs the `DEDUPE` node (AF-M10-10), which is the same question asked mid-graph.

**Costs.** Latency is bounded below by the sweep cadence: nothing polls faster than once a minute, and the practical default is five. That is inherent to polling, and the providers that matter here offer nothing better.

A poller returning unstable ids silently breaks dedupe — the framework cannot detect it, and the symptom is duplicate runs. Every poller's contract test asserts id stability across two polls of unchanged data.

**Forecloses.** Nothing. Where a provider does offer webhooks (GitHub, Intuit, Stripe, Telegram) those stay webhook triggers; polling is for the providers that do not.

## Alternatives considered

**Cursor only, no id window.** Simpler and wrong: inclusive "since T" semantics mean the boundary item is returned twice, and a poll that fails after dispatch retries from the same cursor. Both produce duplicate runs, which is the failure users notice and cannot undo.

**Exactly-once via provider idempotency keys.** Not available. Sheets, Drive and Gmail offer nothing to key on, and building it for the two providers that do would leave the framework with two delivery guarantees.

**Dispatch first, persist after.** Loses runs on every crash instead of costing one duplicate-free cycle. The chosen order fails in the direction that the id window already handles.

**A separate `poll-triggers` cron function.** Rejected: same workflow read, same tick, and two definitions of "active" that would drift.

**Let each connector own its own state.** This is what the naive version of this milestone would have produced — eighteen connectors each with a cursor and their own idea of dedupe. The bug this ADR exists to prevent would then be eighteen bugs, found one provider at a time by users.
