# Load testing

**Status:** Harness built (AF-M8-05). **No run has been performed** — see §5.
**Read before:** claiming the service handles any particular load.
**Companions:** `docs/operations/slos.md`, `docs/operations/beta_launch_checklist.md` (item 3.7).

---

## 1. Why this document exists

The launch checklist asked for "load tested to a concurrency target" and recorded the honest problem: **no target was documented anywhere**. A load test without a target is a number with nothing to compare it to, so this file proposes one, derives it from limits the code already enforces, and gives you the command that measures it.

Two things are true at once and both belong here:

- The harness is real and runs.
- **Nothing has been measured yet.** Running it needs a deployed environment and an API key, neither of which lives in the repository. Until §5 is filled in, the correct answer to "how much load does AutoFlow handle?" is *we do not know*.

---

## 2. The proposed target

**Sustain 100 requests/second to the public API for 5 minutes, from 50 concurrent clients, with zero 5xx and p95 under 1s.**

Nothing about that number is arbitrary:

| Where it comes from | Value |
|---|---|
| `PLAN_BUCKETS.PRO` refill rate (`src/lib/rate-limit/store.ts`) | 100 req/s |
| One Pro tenant, saturating their own bucket | 100 req/s |
| S1 availability SLO (`slos.md`) | 99.5% → error budget 0.5% |
| S3 execution latency SLO | 95% of runs under 60s |

The target is **one Pro tenant using everything they are entitled to**. If a single paying customer at their published rate limit can degrade the service, the rate limit is a fiction and the plan is oversold. That is the smallest claim worth being able to make, and it is the one the pricing already implies.

It is deliberately *not* "N concurrent users" — that number depends on how a user behaves and is unfalsifiable. Requests per second against a published limit is a claim that can fail.

### Pass/fail

Encoded in `TARGETS` in `scripts/load-test.ts`, so the script's exit code is the verdict:

| Gate | Threshold | Why |
|---|---|---|
| 5xx responses | **0** | A saturated service must shed load with 429, which is a correct answer. A 500 is not. |
| Error rate (excluding 429) | ≤ 0.5% | Matching the S1 error budget. A load test that fails more than the steady-state target proves nothing. |
| p95 latency | ≤ 1000ms | Not an SLO — `slos.md` §2 deliberately declines to write HTTP latency targets against instrumentation we do not have — but a release gate. |

**429 is a pass, not a failure.** It means the token bucket worked. A run that returns thousands of 429s and no 5xx is the system behaving exactly as designed under overload; that is the outcome to hope for, not to fix.

---

## 3. Running it

### What you need

1. **A deployed environment that is not production.** The `run` profile starts real workflow executions.
2. **An API key** for a workspace in it, with the `workflows:read` scope (add `workflows:execute` for the run profile). Create one through the `apiKeys` tRPC router as an org admin.
3. **A workspace on the plan you are testing.** A FREE workspace has a 60-token bucket refilling at 1/s, so it will shed almost everything and measure the rate limiter rather than the service.

### The read profile — start here

```bash
npm run load-test -- --url https://staging.example.com --key af_xxx --concurrency 50 --duration 300
```

`GET /api/v1/workflows`. Exercises bearer auth, the token bucket, the org scope, and one indexed read. Cheap per request, so it saturates connections before it saturates CPU — which is what makes it the right first probe: **connection-pool exhaustion is the failure this codebase is most likely to have**, because a serverless deployment opens a pool per instance and Postgres counts them all.

### The run profile — destructive

```bash
npm run load-test -- --url https://staging.example.com --key af_xxx \
  --profile run --workflow wf_123 --concurrency 20 --duration 60
```

`POST /api/v1/workflows/:id/run`. Quota check, `Execution` insert, enqueue. Every request that is not shed **starts a real run** against whatever that workflow connects to. Use a workflow whose nodes are inert, in a workspace you do not mind filling with executions, and never point it at production.

Expect quota denials once the plan's monthly run allowance is spent (`PLAN_QUOTA_LIMITS`). Like 429, that is the system working.

---

## 4. What to look at when it fails

| Symptom | Look at |
|---|---|
| 5xx climbing with concurrency, `too many connections` in logs | Postgres connection limit vs. pool size per instance. Runbook in `runbooks.md`. |
| p95 fine, p99 terrible | Cold starts, or one slow query on an unindexed column. Check the slowest route in Sentry. |
| Transport errors (`ERR` in the distribution) | Client-side socket exhaustion — lower `--concurrency` and confirm before blaming the server. |
| Everything 429 immediately | The workspace is on a plan whose bucket is smaller than your load. Check `Organization.plan`. |
| Everything 401 | The script fails fast on this now; check the key's scopes. |

**A finding is only a finding once it reproduces.** Run twice before opening a task.

---

## 5. Results

No run has been performed. Record each one here — date, environment, profile, the numbers, and what was fixed:

| Date | Environment | Profile | Concurrency | req/s | p95 | 5xx | Verdict |
|---|---|---|---|---|---|---|---|
| — | — | — | — | — | — | — | Not yet run |

Until this table has a row, checklist item 3.7 stays open and no claim about capacity is supportable.
