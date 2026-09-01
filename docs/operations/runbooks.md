# Incident runbooks

**Status:** Built (AF-M8-07).
**Read before:** taking an on-call shift, or during an incident.
**Companion:** `docs/operations/slos.md` for the SLOs, error budgets, and alert thresholds that page you here.

Five failure modes, chosen because each is one this system can actually reach and none of them is detected by the others. Each entry is written to be read at 3am: symptom first, then how to confirm it, then what to do, in that order.

A rule that applies to every entry: **do not restart before you have captured the evidence.** A restart clears the state that explains the incident, and every failure below is one where the state is the diagnosis.

---

## Signals available

| Source | What it tells you | Where |
|---|---|---|
| `/api/health` | `database` + `runner` state, from inside the app | This deployment, unauthenticated |
| `/status` | The same, rendered for humans | This deployment, unauthenticated |
| Sentry | Exceptions with scrubbed context (AF-M8-16) | Sentry project |
| Inngest dashboard | Per-function runs, retries, throughput, failures | Inngest app |
| `Execution` table | Ground truth for what actually ran | Postgres |
| Structured logs | `logger` output, secrets redacted | Host log drain |

**There is no metrics backend.** No Prometheus, no Grafana, no time-series of latency. "Check p95" below means the monitoring dashboard's own aggregate, which is computed from `Execution` rows on demand. This is a real limitation and it is why the alert definitions in `slos.md` are mostly thresholds on counts, not on percentiles.

---

## F1 — Executions accepted but never complete

**The most dangerous failure mode in this system**, because every surface keeps working. The app serves, the canvas saves, triggers fire, runs appear in the list — and nothing finishes. To a user, their automation silently stopped.

**Symptoms**
- `/api/health` reports `runner: degraded` or `down`.
- Runs sit in `RUNNING` well past any sane duration.
- The monitoring dashboard's success rate falls while the run count does not.

**Confirm**
```sql
SELECT status, count(*), min("startedAt"), max("startedAt")
FROM "Execution"
WHERE "startedAt" > now() - interval '2 hours'
GROUP BY status;
```
A pile of `RUNNING` with an old `min(startedAt)` and no recent `SUCCESS` confirms it.

**Diagnose, in order**
1. **Inngest cannot reach us.** The most common cause. Inngest drives execution by calling `/api/inngest`; if that URL is unreachable, misconfigured after a domain change, or failing signature verification, functions are never invoked. Check the Inngest dashboard for delivery failures against the app's sync URL.
2. **Signing key mismatch.** `INNGEST_SIGNING_KEY` / `INNGEST_EVENT_KEY` rotated in one place and not the other. Symptom is 401s on the sync endpoint.
3. **Function throwing before its first step.** Check Sentry for exceptions inside `executeWorkflow`. A throw before `create-execution` leaves no trace row, so the DB will under-report the problem.
4. **Concurrency starvation.** One tenant's long-running workflow saturating the concurrency limit. Inngest's dashboard shows queued vs running.

**Mitigate**
- If Inngest cannot reach the app, fixing the URL or key restores delivery and queued runs drain on their own. **Do not** manually mark rows `FAILED` first; they will complete.
- If a single workflow is starving the queue, deactivate it (clear `activeVersionId`) to stop new runs while leaving history intact.

**Aftermath.** Runs stuck `RUNNING` beyond the retention delete window are pruned by AF-M8-06 rather than lingering forever. That is cleanup, not recovery — it does not re-run anything.

---

## F2 — Database unavailable or connection pool exhausted

**Symptoms**
- `/api/health` reports `database: down`, endpoint returns 503.
- Broad 500s across tRPC and the public API.
- Sentry fills with `PrismaClientKnownRequestError` / connection timeouts.

**Confirm**
```sql
SELECT count(*), state FROM pg_stat_activity GROUP BY state;
SHOW max_connections;
```
Exhaustion looks like a connection count at the ceiling with many `idle in transaction`.

**Diagnose**
1. **Is the database up at all?** Provider status page first. If it is down, this is F2-hard and the only action is to communicate.
2. **Pool exhaustion** — `idle in transaction` accumulating means something opened a transaction and never closed it. Long `$transaction` blocks or a hung query are the usual sources.
3. **A slow query saturating connections.** The retention sweep (AF-M8-06) is bounded and batched precisely so it cannot be this, but check whether it is running (03:45 UTC) before ruling it out.

**Mitigate**
- Terminate stuck sessions:
  ```sql
  SELECT pg_terminate_backend(pid) FROM pg_stat_activity
  WHERE state = 'idle in transaction' AND state_change < now() - interval '10 minutes';
  ```
- If the pool is simply too small for load, raise the connection limit in `DATABASE_URL` — but only after confirming the database can take it.

**Do not** run `prisma migrate reset` or `db push`. Ever, but especially here. See AGENTS.md DON'T-8.

---

## F3 — Credentials fail to decrypt across the board

The signature failure of a key mistake. Individual credential failures are user error; **all** credentials failing at once is ours.

**Symptoms**
- Every credentialed node fails, across every tenant, starting at a deploy boundary.
- Errors from `openSecret` / the credential resolver, not from the third-party API.
- Non-credentialed workflows are unaffected — that asymmetry is the tell.

**Confirm.** Check whether failures began exactly at a deploy. Compare the deployed `CREDENTIAL_MASTER_KEY` against the one the ciphertexts were written with. Do **not** print the key, and do not paste it into a ticket.

**Diagnose**
1. **Wrong or missing KEK.** The app refuses to boot without `CREDENTIAL_MASTER_KEY` (AF-M0-08), so a *missing* key is a boot failure, not this. A *wrong* key boots fine and fails every unwrap — that is this.
2. **Partial key rotation.** `keyVersion` exists so N-1 versions stay readable during a rotation window. If a rotation dropped the old key before re-wrapping finished, rows at the old version fail while new ones work. The `keyVersion` distribution tells you:
   ```sql
   SELECT "keyVersion", count(*) FROM "Credential" GROUP BY "keyVersion";
   ```
3. **Tampered ciphertext.** GCM auth tags are verified, so tampering fails loudly rather than yielding garbage. Broad tag failures point at storage corruption or a restore from an inconsistent backup.

**Mitigate.** Restore the correct KEK and redeploy. Decryption is stateless — no data repair is needed once the right key is present.

**Never** attempt to "recover" by writing plaintext, disabling decryption, or adding a read path. There is no read path, for anyone, ever (security.md §3).

---

## F4 — AI provider outage or a runaway spend

Two different incidents that present similarly and both live in the AI path.

**Symptoms — outage**
- AI nodes fail while every other node type succeeds.
- Fallback chains exhausting (`src/lib/ai/fallback.ts`) rather than serving.

**Symptoms — runaway spend**
- Cost dashboard climbing far above baseline.
- Usually one workflow, often a loop or a schedule that was tightened.

**Confirm**
```sql
SELECT model, count(*), sum("costUsd")
FROM "NodeExecution"
WHERE "startedAt" > now() - interval '1 hour'
GROUP BY model ORDER BY 3 DESC;
```

**Diagnose**
1. **Provider status page.** If the primary is down and fallbacks are configured, runs should still be served by a fallback — if they are not, the chain is misconfigured, and that is our bug not theirs.
2. **Response cache.** A cache with a very short TTL, or a prompt fingerprint changing every run (a timestamp in the prompt), turns a cached workload into a paid one. `ai.cacheStats` reports the hit rate.
3. **Which org.** Group the query above by `organizationId` through `Execution` to find whether it is one tenant.

**Mitigate**
- Outage: nothing to do beyond confirming fallbacks work. If they do not, that is a bug to fix, not an incident to wait out.
- Spend: deactivate the offending workflow. **There is no AI-spend cap in the runner today** — `monthlyAiSpendUsd` exists in `PLAN_QUOTA_LIMITS` but nothing enforces it (deferred from AF-M7-04). The execution-count quota is the only automatic brake, and a single expensive run passes it.

---

## F5 — Webhook flood from one tenant

**Symptoms**
- Sharp rise in `429`s from `/api/webhooks/...`.
- Elevated DB load with a normal-looking success rate.
- Concentrated on one `workflowId`.

**Confirm.** Rate-limit rejections are logged by the shared limiter (AF-M8-02). Group recent `Execution` rows by `workflowId` where `trigger = 'WEBHOOK'`.

**Diagnose**
1. **Working as designed?** The plan-aware token bucket is *supposed* to shed this load. A wall of 429s with the app healthy is the control working, not an incident.
2. **Genuinely undersized bucket.** A legitimate high-volume integration on a plan whose bucket is too small. `PLAN_BUCKETS` in `src/lib/rate-limit/store.ts`.
3. **Retry storm.** A sender that retries aggressively on 429 without honouring `Retry-After` amplifies rather than backs off.

**Mitigate**
- Deactivate the workflow to shed load entirely if the app is genuinely degraded.
- **Know this limitation:** the rate-limit store is in-memory and **per instance** (ADR-0013). Across N replicas the effective limit is N× the configured one, and a restart resets every bucket. Under a flood spanning replicas the limiter is weaker than its numbers suggest. The distributed store is the fix and is not built.

---

## What is not covered

Written down because an incomplete runbook that looks complete is a trap:

- **No paging rotation.** No PagerDuty, no schedule, no escalation policy. `slos.md` defines what *should* alert; delivering it to a human is configuration that does not exist yet.
- **No backup/restore procedure.** Restore has never been rehearsed (an open item in security.md §13), so there is no runbook for data loss. That is the most serious gap on this page.
- **No rollback runbook.** Deployment rollback is whatever the host provides; nothing here is written down or tested.
- **No status-page incident history.** `/status` reports the current instant only, and it cannot report an outage severe enough to stop it rendering — which is why alerting must poll `/api/health` from outside.
