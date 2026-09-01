# SLOs, error budgets, and alerting

**Status:** Specification (AF-M8-07). The SLOs and alert definitions are decided; the **delivery** of alerts to a human is configuration that does not exist yet — see §5.
**Companion:** `docs/operations/runbooks.md` for what to do when one of these fires.

---

## 1. What we can actually measure

Be honest about the instrumentation before writing targets against it.

| We have | We do not have |
|---|---|
| `Execution` / `NodeExecution` rows — ground truth for every run, with `status`, `durationMs`, `costUsd` | Any time-series metrics backend (no Prometheus, no Grafana, no Datadog) |
| Sentry exceptions, scrubbed (AF-M8-16) | Request-level latency histograms for HTTP surfaces |
| `/api/health` — `database` + `runner` (AF-M8-07) | Uptime probing from outside this deployment |
| Inngest's own per-function dashboard | Alert routing to a person |

Two consequences shape everything below:

1. **Availability is measured by an external prober, not by us.** A service cannot credibly report its own uptime — the failure that matters is the one where it answers nothing at all.
2. **Latency SLOs are on execution duration, not HTTP response time**, because execution duration is the thing we store. HTTP latency targets would be aspirations with nothing behind them, so they are not written here.

---

## 2. Service level objectives

Windowed over **28 days**, rolling.

| # | SLI | Definition | SLO |
|---|---|---|---|
| **S1** | API availability | Fraction of external `/api/health` probes returning a non-5xx status | **99.5%** |
| **S2** | Execution success | `SUCCESS` ÷ (`SUCCESS` + `FAILED` + `TIMED_OUT`) over production-mode runs | **99.0%** |
| **S3** | Execution latency | Fraction of runs whose `durationMs` is under 60s | **95%** |
| **S4** | Trigger fidelity | Fraction of accepted triggers that produce an `Execution` row | **99.9%** |

**S2 deliberately excludes `CANCELLED` and `QUOTA_EXCEEDED`.** A user cancelling a run is not a failure, and a quota refusal is the system working correctly — counting either would let a product decision consume an engineering error budget.

**S4 is the F1 detector.** It is the only SLI that catches "accepted but never ran", which every other measure reports as healthy. It is also the hardest to measure, because a trigger that vanishes before writing a row leaves nothing to count — in practice it is approximated by webhook/API 2xx responses versus rows created.

---

## 3. Error budgets

A 28-day window at each target buys:

| SLO | Target | Budget over 28 days |
|---|---|---|
| S1 availability | 99.5% | **3h 22m** of failed probes |
| S2 execution success | 99.0% | 1 failed run in 100 |
| S3 execution latency | 95% | 5 runs in 100 over 60s |
| S4 trigger fidelity | 99.9% | 1 dropped trigger in 1,000 |

**The budget is a decision rule, not a scoreboard.** Its only purpose is to answer "do we ship the next feature or fix reliability first":

- **Budget remaining** → ship.
- **Budget more than half consumed with over half the window left** → the next thing shipped is reliability work.
- **Budget exhausted** → feature work stops until the window rolls or the cause is fixed.

Nobody is on the hook for a perfect month. A team that never spends its budget has set the target too low and is over-investing in reliability at the expense of the product.

---

## 4. Alert definitions

Every alert names the runbook entry it maps to. **An alert with no runbook entry should not exist** — it teaches people to ignore alerts.

| Alert | Condition | Severity | Runbook |
|---|---|---|---|
| `health-down` | `/api/health` returns 5xx for 2 consecutive probes (~1 min) | **Page** | F2 |
| `runner-stalled` | `runner` check reports `down` (≥25 stuck runs) for 10 minutes | **Page** | F1 |
| `runner-degraded` | `runner` reports `degraded` for 30 minutes | Ticket | F1 |
| `credential-decrypt-failures` | ≥10 credential-resolution exceptions in 5 minutes across ≥2 organizations | **Page** | F3 |
| `execution-failure-rate` | S2 below 95% over a rolling hour, ≥20 runs in the window | Ticket | F1 / F4 |
| `ai-spend-spike` | Hourly `costUsd` above 5× the trailing 7-day hourly mean | Ticket | F4 |
| `webhook-flood` | ≥1,000 `429`s from one `workflowId` in 5 minutes | Ticket | F5 |
| `retention-backlog` | Retention sweep reports `truncated: true` on 3 consecutive nights | Ticket | ADR-0016 |

**Severity means:** *Page* = wake someone. *Ticket* = a human looks during working hours.

Two thresholds are deliberately not tighter:

- `credential-decrypt-failures` requires **≥2 organizations** because one tenant's credential failing is user error — a rotated third-party token. Across tenants it is our key (F3).
- `runner-degraded` waits 30 minutes because a single crashed run is normal background noise; the alert is for a trend.

---

## 5. What is not built

- **No alert delivery.** Everything in §4 is a definition. `health-down` and `runner-stalled` need an external uptime monitor polling `/api/health`; the rest need either Sentry alert rules or a metrics backend that does not exist. **Nothing pages anyone today.**
- **No external prober**, so S1 is currently unmeasured. This is the first thing to fix — it is also the cheapest, being one monitor pointed at one URL.
- **No on-call rotation, escalation policy, or incident log.**
- **No burn-rate alerting.** Budget consumption is computed by hand from the tables, not tracked.
- **S4 is not instrumented.** Comparing accepted triggers to created rows needs a counter at the trigger boundary that does not exist yet.

Filed as **AF-M8-21**. Until it is done, these SLOs are targets we can verify after the fact but not be told about, and the honest summary is: **we would find out about most of these from a customer.**
