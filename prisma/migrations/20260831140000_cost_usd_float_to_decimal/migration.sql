-- AF-M8-11: Convert costUsd from Float (DOUBLE PRECISION) to Decimal(12,6).
-- Expand-migrate-contract pattern: add new column, backfill, drop old, rename.
-- All three changes are in a single transaction — the tables are small relative
-- to the operation cost, and partial migration would leave the schema inconsistent.

BEGIN;

-- ── Execution ────────────────────────────────────────────────────────────────
ALTER TABLE "Execution" ADD COLUMN "costUsd_new" DECIMAL(12,6) NOT NULL DEFAULT 0;
UPDATE "Execution" SET "costUsd_new" = "costUsd";
ALTER TABLE "Execution" DROP COLUMN "costUsd";
ALTER TABLE "Execution" RENAME COLUMN "costUsd_new" TO "costUsd";

-- ── NodeExecution ────────────────────────────────────────────────────────────
ALTER TABLE "NodeExecution" ADD COLUMN "costUsd_new" DECIMAL(12,6) NOT NULL DEFAULT 0;
UPDATE "NodeExecution" SET "costUsd_new" = "costUsd";
ALTER TABLE "NodeExecution" DROP COLUMN "costUsd";
ALTER TABLE "NodeExecution" RENAME COLUMN "costUsd_new" TO "costUsd";

-- ── AiResponseCache ──────────────────────────────────────────────────────────
ALTER TABLE "AiResponseCache" ADD COLUMN "costUsd_new" DECIMAL(12,6) NOT NULL DEFAULT 0;
UPDATE "AiResponseCache" SET "costUsd_new" = "costUsd";
ALTER TABLE "AiResponseCache" DROP COLUMN "costUsd";
ALTER TABLE "AiResponseCache" RENAME COLUMN "costUsd_new" TO "costUsd";

COMMIT;
