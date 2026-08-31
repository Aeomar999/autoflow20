-- AF-M7-04: a distinguishable terminal status for quota-breached runs.
--
-- Additive only. `QUOTA_EXCEEDED` records a run the runner hard-failed at the
-- run gate (ADR-0010 / tasks.md M7 addenda): the org hit its monthly
-- execution-count limit. It is kept distinct from `FAILED` / `CANCELLED` so
-- metering counts and the executions UI can tell "quota refusal" apart from
-- any other terminal outcome.
--
-- Guarded so it is replayable (matching the other additive migrations).
-- Postgres cannot express `ADD VALUE IF NOT EXISTS` directly, so the guard
-- checks `pg_enum`. The enum type is created by Prisma as the case-preserving
-- `"ExecutionStatus"`, so the lookup joins `pg_type` by exact `typname` —
-- `'ExecutionStatus'::regtype` would fold to `executionstatus` and miss it.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'ExecutionStatus'
      AND e.enumlabel = 'QUOTA_EXCEEDED'
  ) THEN
    ALTER TYPE "ExecutionStatus" ADD VALUE 'QUOTA_EXCEEDED';
  END IF;
END $$;