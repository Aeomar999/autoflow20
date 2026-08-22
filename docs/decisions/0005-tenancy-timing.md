# 0005 — Introduce tenancy at M6, not later

**Status:** Accepted
**Date:** 2026-08-02
**Deciders:** Engineering

## Context

Today, ownership is a single `Workflow.userId` column and authorization is an ownership check in each resolver. There are no organizations, workspaces, roles, sharing, or audit trail.

The PRD requires RBAC (Admin/Editor/Viewer), audit logs, approvals, and quotas — all of which are *organization-scoped* concepts. None of them can be built on single-user ownership.

The cost of retrofitting tenancy grows with every table, query, router, prefetch, and test written before it. Each new milestone adds surface that will have to be rewritten: M2 adds `Execution` and `NodeExecution`, M3 adds `Credential`, M4 adds `WorkflowVersion` and webhooks, M5 adds AI cache rows. Deferring tenancy to "when enterprise asks" means the rewrite lands when the codebase is at its largest and the customer is waiting.

Conversely, doing it *first* is also wrong: tenancy on a product that cannot execute a workflow is governance over nothing, and it delays the engine, which is the actual critical path.

## Decision

Tenancy lands at **M6** — after the engine (M2), credentials (M3), triggers (M4), and AI (M5), and before templates, dashboards, and quotas (M7).

Two supporting rules apply to every milestone *before* M6:

1. **Every tenant-scoped table gets `organizationId` denormalized directly onto it**, even when reachable via a parent. This makes the tenant filter one indexed predicate rather than a join, and makes accidental cross-tenant reads structurally harder.
2. **New tables added in M2–M5 are designed with the tenancy column present from the start** (nullable until M6 backfills). We pay a small cost now instead of a migration per table later.

The migration itself follows expand → backfill → verify → migrate reads router-by-router → contract (`docs/architecture/data_model.md` §4). No feature work runs against the same files during it.

## Consequences

**Buys us**
- The engine ships on schedule; governance arrives before the features that assume it (quotas and dashboards in M7 are per-workspace by definition).
- The M6 rewrite touches five milestones' worth of code instead of nine.
- SSO, audit, sharing, and approvals all become possible in one coherent change rather than five partial ones.

**Costs**
- M6 is the highest-regression milestone in the plan. Authorization is rewritten everywhere at once.
- Between M2 and M6 the product is single-user. No team can pilot it, which constrains early design-partner selection.
- Nullable `organizationId` columns exist for several milestones and must not be assumed non-null before the contract step.

**Forecloses**
- Nothing. It is a sequencing decision, revisitable in one direction (earlier) if a design partner requires teams sooner.

## Alternatives considered

**Tenancy first, before the engine.** Rejected: delays the critical path to build governance over a product that cannot run a workflow. Also risks designing roles against imagined rather than observed usage.

**Defer to "when enterprise asks."** Rejected: this is the version that costs the most. The rewrite arrives at maximum codebase size, under customer time pressure, with the highest chance of an isolation bug — the single worst class of bug for this product.

**Row-level security in Postgres instead of application-level scoping.** Attractive as defense in depth. Rejected as the primary mechanism: Prisma's support is awkward, and it moves authorization somewhere reviewers do not read. Reconsider as a *second* layer in Phase 3.

**Schema-per-tenant or database-per-tenant.** Rejected: operationally heavy, painful for migrations and cross-tenant analytics, and unnecessary at our scale. Revisit only for a specific enterprise isolation requirement.

## Follow-up

- `AF-M2-01`, `AF-M3-02`, `AF-M4-01` must include `organizationId` on every new table.
- `AF-M6-03` is a standalone cross-tenant isolation suite, and it is a merge gate for M6.
