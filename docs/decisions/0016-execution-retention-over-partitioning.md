# 0016 - Two-stage execution retention now; partitioning deferred behind a trigger

**Status:** Accepted (AF-M8-06).

## Context

`Execution` and `NodeExecution` are the highest-growth tables in the system:
one row per run, and one row per node per run. A workflow on a five-minute
schedule with eight nodes produces roughly 288 executions and 2,300 node
executions per day, per workflow. Both tables carry `input`/`output` JSON,
which is customer data and the overwhelming majority of the bytes.

Nothing removed any of it. Two documents were making promises the code did not
keep:

- `docs/architecture/security.md` §9: "Execution IO is customer data: access is
  tenant-scoped, **retention is bounded**." It was not bounded.
- `docs/architecture/data_model.md` §2.4: "These are the highest-growth tables
  in the system. Retention and partitioning are `AF-M8-04`." That id belongs to
  the auth-email task; the work is AF-M8-06.

`implementation_plan.md` R8 rates "execution table growth degrades the DB" as a
medium/medium risk mitigated by "retention + partitioning in M8".

## Decision

### 1. Retention runs in two stages, not one

- **IO redaction** at `ioRetentionDays`: `input` and `output` are set to SQL
  NULL on both tables.
- **Deletion** at `deleteAfterDays`: the `Execution` row is deleted;
  `NodeExecution` follows by `onDelete: Cascade`.

A single delete stage would have forced a choice between holding customer
payloads for as long as we want cost history, or throwing away cost history as
fast as we want to drop payloads. Two stages needs neither: the monitoring and
cost dashboards keep reporting truthfully across their whole window on rows
whose payloads are long gone, because status, timings, tokens, `costUsd`,
`model`, and error text all survive redaction.

It also means the privacy promise is kept on a much shorter clock than the
analytics one — 7 days on FREE versus 35.

### 2. Windows are per-plan data, and the delete window has a hard floor

`PLAN_RETENTION` in `src/lib/retention.ts` maps plan to policy, the same shape
as `PLAN_QUOTA_LIMITS`. An unknown or NULL plan collapses to FREE (ADR-0010) —
for retention, "more than FREE" means keeping data *longer*.

The floor is the subtle part. The runner meters the monthly execution quota by
**counting `Execution` rows in the current calendar month**. A delete window
shorter than a month would remove rows that are still being counted, so the
pruner would silently refund quota — handing out paid capacity on a timer.
`QUOTA_SAFE_DELETE_FLOOR_DAYS` is 35, and a unit test asserts every plan
honours it, so lowering a window below the quota window fails the build instead
of leaking revenue quietly.

### 3. No archival tier

Expired rows are deleted, not copied anywhere first. Archiving to object
storage would add a storage dependency and a second copy of customer data to
secure, delete on request, and reason about in the threat model — for a
retrieval nobody has asked for. The honest alternative already exists: the
public REST API (ADR-0012) can read executions, so a customer who needs history
beyond their window can export it while it is still there.

This is the decision to revisit first if an enterprise contract specifies a
retention term longer than we want to keep hot rows. ENTERPRISE is currently
"never delete", which is a promise made of disk.

### 4. Partitioning is deferred, with a stated trigger

We are **not** partitioning `NodeExecution` now.

Declarative partitioning would mean:

- The partition key must be part of the primary key, so `NodeExecution`'s PK
  becomes `(id, startedAt)`. Prisma has no first-class support for partitioned
  tables, so the table would have to be created and maintained by raw SQL in
  migrations, and `prisma migrate diff` would keep trying to "correct" it back.
- Something must create next month's partition before rows arrive for it —
  another scheduled job whose failure mode is write errors on the busiest
  table, not a slow query.

The benefit that buys is dropping old data by `DROP PARTITION` instead of
`DELETE`, and keeping index depth flat. Both matter — at a size this table is
nowhere near. With retention enforced, the table is now *bounded* rather than
growing without limit, which was the actual risk in R8.

**Revisit when any of these holds:**

- `NodeExecution` exceeds ~50M rows, or the table plus indexes exceeds ~50 GB.
- The nightly sweep reports `truncated: true` on consecutive days at its
  configured ceiling — the backlog is outgrowing the pruner.
- Autovacuum cannot keep up with the delete churn (rising dead-tuple ratio, or
  bloat that a manual `VACUUM FULL` window would be needed to reclaim).

The first is the one to watch: `DELETE` leaves dead tuples that autovacuum must
reclaim, and the point of partitioning is that `DROP` does not.

## Consequences

- Old runs disappear from the monitoring and cost dashboards once past the
  delete window. On FREE that is 35 days, so a "last 90 days" view is
  necessarily plan-dependent. The dashboards do not currently say so — a UI
  follow-up, **AF-M8-20**.
- ENTERPRISE never deletes, so its `NodeExecution` rows still grow without
  bound. Redaction caps the *bytes per row*, not the row count. That plan is
  the one that will hit the partitioning trigger first.
- The sweep is bounded per run, so a large backlog drains over several nights
  rather than in one. `truncated: true` in the result and a `warn` log say when
  that is happening.
- Deleting an `Execution` also removes its `ApprovalRequest` rows by cascade.
  No approval node ships yet (AF-M8-13), so nothing is lost today, but an
  approval older than the window would vanish with its run once one does.
