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
| 1.4 | **Paying actually upgrades the workspace** | 🔴 **BLOCKER — not built** |
| 1.5 | Downgrade / cancellation returns the workspace to FREE | 🔴 **BLOCKER — not built** |
| 1.6 | Failed payment has a defined consequence | 🔴 Not built |
| 1.7 | Prices and product ids configured for the live account | ⬜ Operator task (`POLAR_PRODUCT_ID`) |

### 1.4 is the one that matters

**`Organization.plan` is written exactly once — `"FREE"`, when the organisation is created — and never again.** `organization.update` changes only `name` and `slug`. There is no Polar webhook route, no webhook handler registered on the auth plugin, and no `POLAR_WEBHOOK_SECRET`.

Every plan-derived behaviour reads that column: the monthly run quota, the API and webhook rate-limit buckets, and the execution retention windows. So a customer can complete checkout, be charged, and remain on FREE limits indefinitely.

Taking payment for a plan that is never applied is the single most serious item on this page. Tracked as **AF-M8-23**.

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
| 2.9 | DNS-rebinding TOCTOU closed | ⬜ AF-M8-17 |
| 2.10 | External review or penetration test | 🔴 Not scheduled |
| 2.11 | `npm audit` enforced in CI | 🔴 Not enforced |

---

## 3. Operations

| # | Item | Status |
|---|---|---|
| 3.1 | Health endpoint and status page | ✅ AF-M8-07 |
| 3.2 | Runbooks for the top failure modes | ✅ AF-M8-07 |
| 3.3 | SLOs and error budgets defined | ✅ AF-M8-07 |
| 3.4 | Retention enforced, tables bounded | ✅ AF-M8-06 |
| 3.5 | **Alerts reach a human** | 🔴 **BLOCKER — nothing pages anyone** (AF-M8-21) |
| 3.6 | **Backup and restore rehearsed** | 🔴 **BLOCKER — never tested** |
| 3.7 | Load tested to a concurrency target | 🔴 AF-M8-05; no target is documented anywhere |
| 3.8 | On-call rotation | 🔴 Does not exist |

**3.5** — the alert definitions exist and nothing delivers them; today an outage is discovered by a customer telling us. The cheapest fix by far is one external uptime monitor on `/api/health`, which lights up both page-severity alerts and starts measuring availability.

**3.6** — a backup that has never been restored is a hypothesis. This is a blocker because the failure it guards against is unrecoverable, and it is the one gap on this page with no partial credit.

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
| 4.7 | Policies linked from signup and the footer | ⬜ Not wired |
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
| 5.2 | Support address configured and monitored | ⬜ Operator task |
| 5.3 | In-app route to support | 🔴 Not built |
| 5.4 | System announcements possible | ✅ `npm run notify:system` (AF-M8-13) |

---

## 6. Go / no-go

Do not open to external users while any of these stands:

1. **1.4 / 1.5 — payment does not change the plan.** Charging for something that is not delivered.
2. **3.5 — no alerting.** An outage is found by a customer.
3. **3.6 — restore never rehearsed.** Data loss would be unrecoverable.
4. **4.5 — policies not lawyer-reviewed.** Publishing them as-is misrepresents an unreviewed draft as a binding document.

Everything else on this page is a real gap that can be carried into beta with its risk understood and written down. These four cannot.
