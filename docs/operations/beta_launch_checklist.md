# Beta launch checklist

**Status:** Built (AF-M8-10).
**Read before:** opening the service to users who are not you.
**Companions:** `docs/operations/runbooks.md`, `docs/operations/slos.md`, `docs/operations/support.md`.

This is a gate, not a wish list. Each item is either done or it is not, and the ones marked **BLOCKER** mean exactly that: shipping without them takes money for something that does not work, or exposes users to a risk they did not agree to.

Status below reflects the code as of **2026-09-01**, verified by reading it rather than by trusting a previous checklist.

---

## 1. Billing

| # | Item | Status |
|---|---|---|
| 1.1 | Checkout flow reaches the payment provider | ✅ Polar checkout + portal wired through the auth plugin |
| 1.2 | Plans defined with limits as data | ✅ `PLAN_QUOTA_LIMITS`, `PLAN_BUCKETS`, `PLAN_RETENTION` |
| 1.3 | Quota enforced in the runner | ✅ AF-M7-04, hard-fails with `QUOTA_EXCEEDED` |
| 1.4 | **Paying actually upgrades the workspace** | ✅ Built (AF-M8-23) and configured 2026-09-02 |
| 1.5 | Downgrade / cancellation returns the workspace to FREE | ✅ Built (AF-M8-23) and configured 2026-09-02 |
| 1.6 | Failed payment has a defined consequence | 🔴 Not built — no `subscription.past_due` branch |
| 1.7 | **Product ids and webhook secret configured for the live account** | ✅ Done 2026-09-02 — verified: `ensureEnv()` passes, 3 distinct product ids, STARTER/PRO/ENTERPRISE all mapped, secret present |
| 1.8 | One subscription is scoped to one workspace | 🔴 Not built — see below |

### 1.4 was the one that mattered, and it is now closed

`Organization.plan` used to be written exactly once — `"FREE"`, at creation — and never again, while the monthly run quota, the API and webhook rate-limit buckets and the retention windows all read that column. A customer could complete checkout, be charged, and stay on FREE limits indefinitely.

**AF-M8-23 built the missing path**: `webhooks()` on the Polar plugin handles `subscription.active` / `.updated` / `.canceled` / `.revoked`, writes the plan, and audit-logs it. It is idempotent, so Polar's re-deliveries are free.

**Configured 2026-09-02.** `POLAR_WEBHOOK_SECRET` is set and all three `POLAR_PRODUCT_ID_*` values are distinct valid UUIDs mapping to STARTER, PRO and ENTERPRISE; `ensureEnv()` passes, so the app boots with this configuration. Verified by reading the resolved plan map, not by trusting that the variables are non-empty.

**Still unverified end to end:** nobody has actually bought a subscription against this configuration. The remaining risk is not the code or the variables but whether the endpoint in the Polar dashboard points at the right URL and is subscribed to the four events. Confirm with a real test purchase before relying on it — `operator_actions.md` B1 has the SQL.

### 1.8 — one subscription currently upgrades every workspace its buyer owns

A Polar customer is a **user**. The checkout carries no organisation, and nothing in the schema links a subscription to a workspace. So a user who owns three workspaces and buys one subscription gets the plan on all three — a revenue leak on the upgrade path, and over-broad when they cancel.

The handler logs a warning when it fans out, so this is visible rather than silent. Closing it needs a product decision — *is a subscription per-user or per-workspace?* — and a checkout that carries the workspace, so it is not a bug fix. Carry it into beta knowingly or decide it first; do not discover it from a customer.

---

## 2. Security

| # | Item | Status |
|---|---|---|
| 2.1 | `npm audit` clean at HIGH+ | ✅ AF-M8-08 (6 LOW remain — AF-M8-19) |
| 2.2 | Credentials encrypted, no plaintext read path | ✅ AF-M3-02/04, proven by test |
| 2.3 | Cross-tenant isolation suite green | ✅ AF-M8-08 / AF-M8-18 |
| 2.4 | SSRF guard including redirect hops | ✅ AF-M8-16 |
| 2.5 | Error and log redaction on every runtime | ✅ AF-M8-16 |
| 2.6 | Rate limits on auth, API, webhooks | ✅ AF-M8-02 |
| 2.7 | Audit logging on mutations | ✅ AF-M6-08 |
| 2.8 | Session cookie flags verified in production | ⬜ Needs a deploy to inspect |
| 2.9 | DNS-rebinding TOCTOU closed | ✅ AF-M8-17 (ADR-0017) |
| 2.10 | External review or penetration test | 🔴 Not scheduled |
| 2.11 | `npm audit` enforced in CI | ✅ Fails the build at HIGH+ |

---

## 3. Operations

| # | Item | Status |
|---|---|---|
| 3.1 | Health endpoint and status page | ✅ AF-M8-07 |
| 3.2 | Runbooks for the top failure modes | ✅ AF-M8-07 |
| 3.3 | SLOs and error budgets defined | ✅ AF-M8-07 |
| 3.4 | Retention enforced, tables bounded | ✅ AF-M8-06 |
| 3.5 | **Alerts reach a human** | ✅ Monitor created by the operator 2026-09-02 (AF-M8-21 / AF-M8-26). Not verifiable from the repository — see below |
| 3.6 | **Backup and restore rehearsed** | 🔴 **BLOCKER — never tested** |
| 3.7 | Load tested to a concurrency target | 🟡 Target + harness built (AF-M8-05); **no run performed** |
| 3.8 | On-call rotation | 🔴 Does not exist |

**3.5** — AF-M8-21 settled *what* to configure and AF-M8-26 recorded it; the operator created the monitor on 2026-09-02. **This is the one closed item on this page that the repository cannot check**, so it is worth proving rather than assuming: take the service down (or point the monitor at a deliberately failing URL) and confirm something actually reaches a phone. An alert nobody has ever seen fire is the same as no alert. The `degraded` body assertion in particular fails silently if the monitor does not support JSON assertions — confirm that one specifically.

**3.6** — a backup that has never been restored is a hypothesis. This is a blocker because the failure it guards against is unrecoverable, and it is the one gap on this page with no partial credit.

**3.7** — `docs/operations/load_test.md` now documents a target derived from the plan limits already sold (100 req/s — one PRO tenant's own bucket) and `npm run load-test` measures it. Nothing has been run: that needs a deployed non-production environment and an API key. **No capacity claim is supportable until §5 of that document has a row in it.**

---

## 4. Legal and policy

| # | Item | Status |
|---|---|---|
| 4.1 | Terms of Service drafted | ✅ `/terms` — **draft, unreviewed** |
| 4.2 | Privacy Policy drafted | ✅ `/privacy` — **draft, unreviewed** |
| 4.3 | DPA drafted | ✅ `/dpa` — **draft, unreviewed** |
| 4.4 | Subprocessor list accurate | ✅ `src/config/legal.ts`, verified against the code |
| 4.5 | **Reviewed by a qualified lawyer** | 🔴 **BLOCKER — not done** |
| 4.6 | Legal entity configured | ⬜ Operator task (see below) |
| 4.7 | Policies linked from signup and the footer | ✅ Landing footer + signup notice |
| 4.8 | Signup records acceptance of the terms | 🔴 Not built |

### The drafts are engineer-written, not lawyer-reviewed

They exist so a lawyer reviews **facts rather than a blank page**: the retention table renders from `PLAN_RETENTION`, so it cannot promise a window the pruner does not honour, and the subprocessor list is the set of services the code actually calls. That makes review cheaper. It does not make review optional, and none of it is legal advice.

The clauses that need a lawyer's judgement and are deliberately thin: liability caps, the international-transfer mechanism and whether standard contractual clauses are required, consumer-law carve-outs, and anything jurisdiction-specific.

### 4.6 — configuring the entity

The pages **refuse to render the policy** until these are set, showing what is missing instead. That is deliberate: a privacy policy displaying `[COMPANY_LEGAL_NAME]` reads as a real policy to a user and as negligence to a regulator, and remembering to fill it in during launch week is not a control.

```
NEXT_PUBLIC_LEGAL_ENTITY_NAME
NEXT_PUBLIC_LEGAL_JURISDICTION
NEXT_PUBLIC_LEGAL_ADDRESS
NEXT_PUBLIC_LEGAL_CONTACT_EMAIL
NEXT_PUBLIC_LEGAL_PRIVACY_EMAIL   (optional — falls back to the contact address)
NEXT_PUBLIC_LEGAL_EFFECTIVE_DATE
NEXT_PUBLIC_SUPPORT_EMAIL
```

---

## 5. Support

| # | Item | Status |
|---|---|---|
| 5.1 | Support process documented | ✅ `docs/operations/support.md` |
| 5.2 | Support address configured and monitored | ⬜ Operator task (`NEXT_PUBLIC_SUPPORT_EMAIL`) |
| 5.3 | In-app route to support | ✅ `/support`, linked from the footer |
| 5.4 | System announcements possible | ✅ `npm run notify:system` (AF-M8-13) |

**5.3** renders what is missing rather than a broken `mailto:` when 5.2 is unconfigured, and states plainly that there is no ticketing system, no response-time commitment and no out-of-hours cover — because a promise made on that page is one somebody has to keep at 3am.

---

## 6. Go / no-go

**Two of the original four cleared on 2026-09-02** — 1.7 (billing configured, verified) and 3.5 (uptime monitor created). Two stand, and one new one has taken their place.

Do not open to external users while any of these stands:

1. **3.6 — restore never rehearsed.** Data loss would be unrecoverable. The only item on this page with no partial credit, and now the most serious thing outstanding.
2. **4.5 — policies not lawyer-reviewed.** Publishing them as-is misrepresents an unreviewed draft as a binding document.
3. **4.6 — the legal entity is still unconfigured.** `NEXT_PUBLIC_LEGAL_*` and `NEXT_PUBLIC_SUPPORT_EMAIL` are all unset, so `/terms`, `/privacy` and `/dpa` **do not render their policies at all** — they show what is missing — and `/support` shows no address. A beta whose Terms page refuses to display is not a beta you can open. This is env configuration, not drafting, and it is independent of 4.5.

**Prove the two that just closed rather than assuming them.** Neither was verified end to end: nobody has made a test purchase against the new Polar configuration, and no alert has ever been seen to fire. Both are the kind of thing that reads as done and turns out not to be at the worst moment — a real test purchase and a deliberately-failed health check are each ten minutes.

Everything else on this page is a real gap that can be carried into beta with its risk understood and written down. These cannot.

**Carried knowingly, if you choose to:** 1.6 (an unpaid month is currently free service), 1.8 (one subscription covers every workspace its buyer owns), 3.7 (no measured capacity), 4.8 (no record of terms acceptance), 3.8 and 2.10. Each is a decision, not an oversight — but it is only a decision if you make it before launch rather than after the first incident.
