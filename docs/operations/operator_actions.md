# Operator actions — what only you can do

**Status:** Built (2026-09-01, after AF-M8-06/07/08/09/10/13).
**Read before:** deciding what to work on next, or asking why a task is still open.
**Companions:** `docs/operations/beta_launch_checklist.md` (the gate), `docs/planning/tasks.md` (the backlog).

Every open M8 item is listed here exactly once, sorted by **who is blocking it**. The distinction that matters:

| Marker | Meaning |
|---|---|
| 🔴 **YOU** | Cannot be done from the codebase. Needs an account, a deploy, a lawyer, a running environment, or a decision only you can make. |
| 🟡 **YOU, then me** | Needs one decision or one credential from you; the code is mine to write once I have it. |
| 🟢 **ME** | Not blocked on you at all. Listed so you can see it is *not* waiting on you. |

If an item is 🟢 and you want it, just say so.

---

## Part 1 — The four beta blockers

These are the go/no-go items from the launch checklist. Nothing else on this page stops a beta.

---

### B1. Payment does not change the plan · `AF-M8-23` · 🟡 YOU, then me

**Severity: highest.** A customer can complete checkout, be charged, and stay on FREE limits forever.

**Why it is broken.** `Organization.plan` is written exactly once — `"FREE"`, when the organisation is created — and never again. `organization.update` changes only `name` and `slug`. There is no Polar webhook route and no `POLAR_WEBHOOK_SECRET`. Quota, rate-limit buckets, and retention windows all read that column, so nothing about a paid subscription reaches the running system.

**What only you can do**

1. **In the Polar dashboard**, create a webhook endpoint pointing at the app:
   ```
   https://<your-domain>/api/auth/polar/webhooks
   ```
   Verified against the installed plugin: `@polar-sh/better-auth@1.8.4` registers a `POST` endpoint at `/polar/webhooks`, and this app mounts Better Auth's catch-all at `/api/auth`, giving the path above. It only exists once I add the `webhooks()` helper in step 4's follow-up — so create the endpoint in Polar, but expect deliveries to fail until that ships.

2. **Copy the signing secret** it gives you into the environment as `POLAR_WEBHOOK_SECRET`. Do not paste it into a ticket, a commit, or this file.

3. **Subscribe the endpoint to these events**, at minimum:
   `subscription.active`, `subscription.updated`, `subscription.canceled`, `subscription.revoked`.

4. **Tell me the product → plan mapping.** Polar product ids are account-specific and I cannot see your dashboard. I need, for each paid tier:
   ```
   <polar_product_id>  ->  STARTER | PRO | ENTERPRISE
   ```

5. **Decide what a failed payment does.** This is a product decision, not an engineering one, and the absence of a branch should not decide it by default:
   - *Immediate downgrade* — honest, but hostile mid-month, and it will silently start failing a customer's live automations on quota.
   - *Grace period* — pick a length (7 days is common) and what the customer sees during it.
   - *No downgrade until the period ends* — friendliest, and means an unpaid month is free service.

**What I do once I have 2, 4, and 5**

Add the `webhooks()` helper to the existing `polar()` plugin in `src/lib/auth.ts`, mapping `subscription.active` → the purchased plan and cancellation/revocation/expiry → `FREE`. Idempotent per webhook event id, because payment providers re-deliver. Audit-logged like every other mutation of an organisation. Integration tests covering upgrade, downgrade, replay, and an unknown product id (which must **not** silently grant a plan).

**How you verify it worked**

Buy a subscription on a test workspace, then:

```sql
SELECT id, name, plan FROM "organization" WHERE id = '<org_id>';
```

It should read the purchased plan, not `FREE`. Then cancel and confirm it returns to `FREE`.

**Until it ships:** support treats "I paid but I'm still limited" as **correct and expected**, escalates, and a manual `UPDATE` is the only remedy (`docs/operations/support.md` §4).

---

### B2. Nothing pages anyone · `AF-M8-21` · 🔴 YOU

**Severity: high.** Eight alerts are defined in `docs/operations/slos.md` §4 and *nothing delivers any of them*. Today an outage is discovered by a customer telling you.

**Why only you.** Alert delivery needs an account and a phone number. There is no code change that makes a laptop ring.

**Do this first — it is 10 minutes and buys the most**

Point any external uptime monitor (Better Stack, Pingdom, UptimeRobot, Checkly — the choice barely matters) at:

```
https://<your-domain>/api/health
```

- **Interval:** 60s. The endpoint's rate limit is 30 requests with 1/s refill per IP, so a monitor checking every 60s from several regions is comfortably inside it.
- **Alert when:** two consecutive failures (~2 min), to avoid paging on a single blip.
- **What counts as a failure:** HTTP 5xx. Note `degraded` deliberately returns **200** — see below.

This single monitor lights up both **page**-severity alerts (`health-down`, `runner-stalled`) and starts measuring the availability SLO, which is currently unmeasured because a service cannot credibly report its own uptime.

**Second, for `runner-degraded` and the rest.** If your monitor supports JSON body assertions, alert separately when `.status` is `"degraded"` for 30 minutes — a partial outage that a 200 will not surface. If it does not support that, note it as a gap rather than assuming coverage.

**Third, in Sentry.** Create an alert rule for `credential-decrypt-failures`: ≥10 credential-resolution exceptions in 5 minutes **across ≥2 organizations**. The two-organization condition is deliberate — one tenant's credential failing is user error (a rotated third-party token); across tenants it is our master key, which is a different incident entirely (runbook F3).

**Fourth, decide the human side.** Who is called, at what hour, and what the escalation is if they do not answer. There is no rotation today. If the honest answer is "nobody, out of hours", write that down rather than leaving it implied.

**Why `degraded` returns 200 and not 503.** A 503 makes a load balancer evict an instance that is still serving useful traffic, turning a partial outage into a total one. Do not "fix" this by changing the status code — configure the monitor to read the body instead.

---

### B3. Backup and restore have never been rehearsed · 🔴 YOU

**Severity: high. This is the one gap on the whole checklist with no partial credit.**

A backup that has never been restored is a hypothesis, not a backup. Everything else on this page degrades gracefully; this one is unrecoverable when it fails.

**Why only you.** It needs the production database, its backup mechanism, and somewhere to restore to. None of that is reachable from the repository.

**Do this**

1. **Confirm backups are actually running.** Check your database provider's console for the schedule, the retention period, and the timestamp of the most recent successful snapshot. "Backups are enabled" is not the same as "a backup completed last night".
2. **Restore one into a scratch database.** Not production. A fresh instance you can throw away.
3. **Point a local app at it** and check that the data is real:
   ```bash
   DATABASE_URL='<scratch-db-url>' npx prisma migrate status
   ```
   Then confirm row counts are plausible:
   ```sql
   SELECT
     (SELECT count(*) FROM "organization")  AS orgs,
     (SELECT count(*) FROM "Workflow")      AS workflows,
     (SELECT count(*) FROM "Credential")    AS credentials,
     (SELECT count(*) FROM "Execution")     AS executions;
   ```
4. **Check the credentials actually decrypt.** This is the step people skip, and it is the step that fails. Ciphertext restores fine while being permanently unreadable if the restored environment does not have the same `CREDENTIAL_MASTER_KEY`. Run one workflow that uses a credential against the scratch database and confirm the node succeeds.
5. **Time it, and write the number down.** "How long to recover" is the only number that matters during an incident, and guessing it under pressure is how a 2-hour outage becomes a 9-hour one.
6. **Record the result** in `docs/operations/runbooks.md` as a new failure mode with the real procedure and the real timing.

**The failure mode to watch for:** the `CREDENTIAL_MASTER_KEY` is deliberately *not* in the database. If it is only in one place — one hosting provider's environment variables, one person's password manager — then losing that place loses every customer credential permanently, and no database backup helps. Confirm the key is escrowed somewhere independent of the app host. **This is worth checking today, before the rehearsal.**

---

### B4. The legal documents are unreviewed drafts · 🔴 YOU

**Severity: high, and cheap to resolve.** `/terms`, `/privacy`, and `/dpa` are written but have not been seen by a lawyer.

**Why only you.** I am not a lawyer and this is not legal advice. Publishing an unreviewed draft as a binding document misrepresents it.

**What you have that makes the review cheap.** The drafts describe what the software *actually does*, so counsel reviews facts rather than filling in a template:

- The retention table on `/privacy` renders from `PLAN_RETENTION`, so the policy cannot promise a window the pruner does not honour.
- The subprocessor schedule is a typed list in `src/config/legal.ts`, verified against the code, shared by the Privacy Policy and the DPA so the two cannot drift.
- The security section of the DPA lists properties that are actually enforced and tested, not aspirations.

**Point counsel at the clauses I deliberately left thin**, because they need legal judgement rather than system knowledge:

1. **Liability cap** — currently "fees paid in the last 12 months". Is that right for your market and insurance?
2. **International transfers** (DPA §6) — the mechanism is described generically. Whether you need Standard Contractual Clauses, and which module, depends on where you and your customers are.
3. **Consumer-law carve-outs** — the beta "as is" disclaimer may not be enforceable against consumers in your jurisdiction.
4. **Jurisdiction-specific rights** — the "Your rights" section is written broadly rather than to a specific regime.
5. **Whether a DPA should be signed rather than published.** Many enterprise buyers require a countersigned document, not a web page.

**Then configure the entity** (until you do, the pages *refuse to render* and show what is missing — that is deliberate, so placeholder text can never be served as a real policy):

```
NEXT_PUBLIC_LEGAL_ENTITY_NAME
NEXT_PUBLIC_LEGAL_JURISDICTION
NEXT_PUBLIC_LEGAL_ADDRESS
NEXT_PUBLIC_LEGAL_CONTACT_EMAIL
NEXT_PUBLIC_LEGAL_PRIVACY_EMAIL     # optional, falls back to the contact address
NEXT_PUBLIC_LEGAL_EFFECTIVE_DATE    # ISO date, e.g. 2026-09-14
NEXT_PUBLIC_SUPPORT_EMAIL
```

**Verify:** load `/privacy` after deploying. If it shows the policy, it is live. If it shows "This document is not published yet", something above is missing or blank.

🟢 **What I can do after:** wire the policy links into signup and the site footer, and record acceptance of the terms at signup (checklist items 4.7 and 4.8). Both are trivial once the documents are real, and pointless before.

---

## Part 2 — Blocked on you, but not blocking beta

---

### C1. The deprecated AI node folders are already deleted · `AF-M8-12` · 🔴 YOU

**Status changed.** This was "blocked until the migration has run everywhere". The folders were deleted in `a4ada53` before that was established across environments, so the remaining question is no longer *may we delete* but *was it safe*.

**Why it matters.** A persisted node holding a type the registry no longer knows makes `validate()` throw `UnknownNodeTypeError` and fails the whole graph **at execution time, on a live workflow** (ADR-0011 §3). There is no startup error and no warning - the first symptom is a customer's automation failing.

**What has been checked**

```bash
npm run verify:legacy-ai-nodes
```

Read-only: two SELECTs, no writes, safe to point at production. It prints the database it is checking, because the failure mode here is verifying a laptop and believing you verified production. Exits non-zero if anything is found, so it can gate a deploy.

Run against `ep-bold-mouse-ay14r501-pooler.c-5.us-east-2.aws.neon.tech/neondb` (whatever this repo's `.env` points at) on 2026-09-01:

```
Live nodes holding a retired type : 0
Active versions referencing one   : 0
CLEAR
```

**What is still unverified — and it is one lookup**

That is the database in this repo's `.env`. It is a hosted Neon instance, not a local one, so it may well be the same database the deployed app uses — but nothing here can confirm that. Open the Vercel project's environment variables and compare the `DATABASE_URL` host against the endpoint above:

- **Same endpoint** → production is verified, and `AF-M8-12` is genuinely clear.
- **Different endpoint** → run the command again with that URL before merging:
  ```bash
  DATABASE_URL='<the-vercel-one>' npm run verify:legacy-ai-nodes
  ```

Repeat for any other environment (staging, preview branches with their own database).

**If it ever comes back NOT CLEAR**

The migration that rewrote those nodes onto `AI_LLM` was deleted in the same commit, so the escape hatch is not in the tree:

```bash
git show a4ada53^:src/nodes/ai/legacy-migration.ts > src/nodes/ai/legacy-migration.ts
git show a4ada53^:scripts/migrate-legacy-ai-nodes.ts > scripts/migrate-legacy-ai-nodes.ts
```

It only imports `./llm/definition`, which still exists, so it restores cleanly without bringing back the deleted node folders. Re-add the `migrate:legacy-ai-nodes` npm script, run it (dry-run first, `-- --yes` to apply), then re-run the verification. Model substitution is a real behaviour change and is printed per node: `gpt-4` → `openai:gpt-4o`, `claude-sonnet-4-5` → `anthropic:claude-3-5-sonnet`, `gemini-2.0-flash` → `google:gemini-1.5-flash`.

---

### C2. Load test to the concurrency target · `AF-M8-05` · 🟡 YOU, then me

**Blocked on a number that does not exist.** "Load test to the concurrency target" is the task, and **no concurrency target is documented anywhere in the repository.** I checked the implementation plan, the architecture overview, and the planning docs.

**Decide two things**

1. **The target.** What should this survive at beta? Useful framing rather than a guess:
   - *Concurrent workflow executions in flight* — the number that actually stresses the engine, the database connection pool, and Inngest concurrency.
   - *Sustained trigger rate* — webhooks or API runs per second.
   - *p95 execution latency budget* — the SLO in `slos.md` says 95% of runs under 60s; a load test should show where that breaks.

   If you have no real number, say so and I will pick a defensible one (something like 50 concurrent executions and 20 triggers/second), record it in an ADR with the reasoning, and measure against it. **A recorded target you can argue with beats an unrecorded one you cannot.**

2. **Where it runs.** A load test against a laptop measures the laptop. Options, in descending order of usefulness: a staging environment matching production; production during a quiet window (risky, and it will write real execution rows that consume real quota); or local Docker, which finds algorithmic problems and connection-pool limits but tells you nothing about real capacity. Tell me which, and whether a test workspace exists that I can point load at.

🟢 **What I do once I have both:** build the harness, run it, and fix what it finds — that last part is usually the bulk of the work.

---

### C3. Verify session cookie flags in production · 🔴 YOU

A checklist item that needs a deployed site; there is nothing to inspect locally.

After deploying, open the site, sign in, and check the session cookie in your browser's dev tools (Application → Cookies). It must have **`Secure`**, **`HttpOnly`**, and **`SameSite=Lax`** (or `Strict`). Missing `Secure` or `HttpOnly` is a real finding — tell me and I will fix the auth configuration.

### C4. Schedule an external review or penetration test · 🔴 YOU

Procurement, not engineering. `docs/architecture/security.md` §13 lists it as an open pre-beta item. `AF-M8-08` closed the internal review and the dependency audit; neither substitutes for someone independent trying to break it.

### C5. Configure and monitor the support inbox · 🔴 YOU

Set `NEXT_PUBLIC_SUPPORT_EMAIL` and make sure a human reads it. `docs/operations/support.md` documents the process; an address nobody watches is worse than no address.

---

## Part 3 — Blocked on scope, not on you

### D1. `APPROVAL_REQUESTED` notifications · part of `AF-M8-13`

Genuinely blocked upstream, and re-verified: the approvals router exposes `list` and `respond` only — both operate on rows that must already exist — and every `approvalRequest.create` in the repo is generated Prisma code. **Nothing creates approval requests** because no approval node ships.

The blocker is the approval node itself (`AF-P2-E`, a Phase 2 epic). Building the notification producer now would be a call site with nothing to call it. The builder and dedupe key are already in place, so wiring is one line the day that node lands.

**Your only decision:** whether to pull `AF-P2-E` forward into beta. Sequencing, not a workaround.

### D2. Upgrade the `@ai-sdk/*` chain · `AF-M8-19` · 🟡 your call on risk

The 6 remaining LOW advisories are all one issue reachable through `@ai-sdk/provider-utils`, and npm's only fix is a **major** on each package (`ai@7`, `@ai-sdk/openai@4`, …). That is an API migration across every AI node and the fallback chain, not an audit fix.

They are LOW, and the exit criterion for `AF-M8-08` was no HIGH findings — so this does not block beta. Tell me whether to do it as a deliberate upgrade (with the AI execute suites as the gate) or leave it.

---

## Part 4 — Not blocked on you at all 🟢

Listed so you know these are not waiting on you. Say the word on any of them:

| Item | What it is |
|---|---|
| `AF-M8-17` | Close the DNS-rebinding TOCTOU in the egress guard — needs a pinned-address dispatcher. The remaining ⬜ in `security.md` §5. |
| `AF-M8-20` | Tell users their execution history window is plan-dependent. A "last 90 days" view on FREE silently shows at most 35. |
| **`npm audit` in CI** | CI runs tsc, lint, test, and build but not `npm audit`. Adding `npm audit --audit-level=high` is a few lines and stops the audit from silently rotting. |
| **The failing dom test** | `monitoring-dashboard.dom.test.tsx` asserts copy no component renders. It fails on `main` too. It is another session's UI work, so I left it — tell me if you want it fixed. |
| Checklist 4.7 / 4.8 | Link the policies from signup and the footer, and record acceptance at signup. Waiting on B4, not on effort. |

---

## Part 5 — The decision list

Everything above that is a decision rather than a task, in one place:

| # | Decision | Blocks |
|---|---|---|
| 1 | Polar product id → plan mapping | `AF-M8-23` (B1) |
| 2 | What a failed payment does: immediate downgrade, grace period (how long?), or none | `AF-M8-23` (B1) |
| 3 | Who is on call, at what hours, and the escalation if unanswered | `AF-M8-21` (B2) |
| 4 | The concurrency target, or "you pick and record it" | `AF-M8-05` (C2) |
| 5 | Where the load test runs | `AF-M8-05` (C2) |
| 6 | Whether to pull the approval node (`AF-P2-E`) into beta | `AF-M8-13` approvals half |
| 7 | Whether to take the `@ai-sdk` major upgrades now | `AF-M8-19` |
| 8 | Liability cap, transfer mechanism, and the other four clauses for counsel | `B4` |

**If you only do one thing:** confirm the `CREDENTIAL_MASTER_KEY` is escrowed somewhere independent of the app host (B3). It takes five minutes, and it is the only item here whose failure mode is permanent, silent, and total.
