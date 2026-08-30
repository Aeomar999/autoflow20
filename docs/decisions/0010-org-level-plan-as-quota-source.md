# ADR-0010: Org-level `Organization.plan` is the source of truth for quotas

**Status:** Accepted
**Date:** 2026-08-30
**Deciders:** Engineering
**Related:** AF-M7-04 (quotas), AF-M7-pre-1 (org-scope data layer), AF-M6-02 (RBAC), ADR-0005 (tenancy timing)

## Context

AF-M7-04 adds per-plan execution and AI-spend quotas to the workflow runner. Before enforcing anything, the system must agree on **what a "plan" is and where it is resolved**. Three competing notions currently disagree:

1. **`Organization.plan`** (enum `FREE/STARTER/PRO/ENTERPRISE`) — exists on the `Organization` model (`prisma/schema.prisma:22`), defaults to `FREE`, is returned by the org router (`organizations/routers.ts:27,39`), but is **never read by any enforcement or billing code**.
2. **Polar per-user subscription state** — `premiumProcedure` (`src/trpc/init.ts:45`) live-calls `polarClient.customers.getStateExternal({ externalId: ctx.auth.user.id })`, keyed on the **user**, even inside an org. It is bypassed when `E2E_SERVER === "1"`.
3. **No plan at all** — the execution paths (`execute`, `run`, `testRun` at `workflows/routers.ts:27,48,95`) are ungated `protectedProcedure`s.

The tension: the implementation plan states "quotas and dashboards are per-workspace concepts," which implies the org is the billing/quota unit. But the only enforcement that exists today (`premiumProcedure`) keys on the *user*. A user can hold a subscription while the org they act in is `FREE`, or vice versa — so "does this org have a paid plan" is currently indeterminate.

## Decision

**`Organization.plan` is the single source of truth for quotas.**

- Quotas are resolved on `ctx.org` — the org the caller is acting **in**, per the resolved org of the current request — not on the caller's personal Polar customer state.
- The `Plan` enum (`FREE/STARTER/PRO/ENTERPRISE`) drives the limits table (`src/lib/quotas.ts`).
- `premiumProcedure`'s per-user Polar check is **retired from the enforcement path**. It may remain as a lightweight *creation* gate at most, but it must never be the thing that decides whether an org may execute a workflow.
- Polar is used for **billing visibility** (customer meter for usage/overage shown to the operator and surfaced in the dashboard), not as the enforcement source. Postgres `Execution` rows are the transactional enforcement count.

### Why org-level and not per-user

1. Matches the product reality (workspaces are the billing unit; the roadmap and implementation plan say so).
2. Fixes the indeterminate "which user's plan applies inside an org" bug.
3. Keeps enforcement transactional and DB-local to the runner (one `count` on `Execution` where `organizationId`), which is faster and testable than a live Polar round-trip on every run.

### What this changes

- `AF-M7-pre-1` must populate `workflow.organizationId` and make reads org-scoped so `ctx.org` is resolvable at the runner.
- The runner (`executeWorkflow` in `src/inngest/functions.ts`) loads the org's plan from the workflow's `organizationId` and consults `src/lib/quotas.ts` before running.
- `E2E_SERVER === "1"` bypasses the **run gate** only under an explicit env flag, never in production.

## Consequences

- **Positive:** one unambiguous plan concept; org is the billing/quota self-contained unit; quotas testable as a pure function in `src/lib/quotas.ts`; no silent dependence on a user's personal subscription.
- **Negative / costs:** `AF-M7-pre-1` (org-scope the data layer) becomes a hard prerequisite; the existing `premiumProcedure` behavior is changed (a migration note must be written for the create-gate semantics); a Polar org/customer mapping may be needed for the metering dashboard.
- **Risk:** if a real customer's plan is ever set on `Organization` out of sync with Polar billing state, enforcement and billing disagree. Mitigation: the Polar wiring (AF-M7-04) synchronizes `Organization.plan` from the org's Polar subscription on webhooks, and the quota UI surfaces the org's current plan from `Organization.plan` only.

## Alternatives considered

- **Per-user Polar state as source of truth** — rejected: user-scoped inside an org gives an indeterminate plan, and is the current footgun.
- **Polar as the enforcement source** (live call per run) — rejected for the first quota PR: adds latency + a network dependency to every execution path and complicates the transaction that must atomically "reserve a run slot." Polar remains the billing/usage record, Postgres the enforcement.
- **Separate `PlanSubscription` table** — deferred: `Organization.plan` already exists and is sufficient for M7; a dedicated entitlement table is a later refinement if plan dimensions grow.
