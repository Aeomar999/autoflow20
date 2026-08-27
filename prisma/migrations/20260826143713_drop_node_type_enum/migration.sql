-- AF-M1-02: Drop the NodeType Postgres enum.
--
-- 1. Migrate data: INITIAL → MANUAL_TRIGGER in both tables.
-- 2. Convert enum columns to plain text.
-- 3. Add new columns to Node (typeVersion, disabled, notes).
-- 4. Drop the enum type.

-- ── Node.type ──────────────────────────────────────────────────────────
-- Rename existing column, create text replacement with data migration.
ALTER TABLE "Node" RENAME COLUMN "type" TO "type_old";
ALTER TABLE "Node" ADD COLUMN "type" TEXT NOT NULL DEFAULT 'MANUAL_TRIGGER';
UPDATE "Node" SET "type" = 'MANUAL_TRIGGER' WHERE "type_old" = 'INITIAL';
UPDATE "Node" SET "type" = "type_old" WHERE "type_old" != 'INITIAL';
ALTER TABLE "Node" ALTER COLUMN "type" DROP DEFAULT;
ALTER TABLE "Node" DROP COLUMN "type_old";

-- ── NodeExecution.nodeType ─────────────────────────────────────────────
ALTER TABLE "NodeExecution" RENAME COLUMN "nodeType" TO "nodeType_old";
ALTER TABLE "NodeExecution" ADD COLUMN "nodeType" TEXT NOT NULL DEFAULT 'MANUAL_TRIGGER';
UPDATE "NodeExecution" SET "nodeType" = 'MANUAL_TRIGGER' WHERE "nodeType_old" = 'INITIAL';
UPDATE "NodeExecution" SET "nodeType" = "nodeType_old" WHERE "nodeType_old" != 'INITIAL';
ALTER TABLE "NodeExecution" ALTER COLUMN "nodeType" DROP DEFAULT;
ALTER TABLE "NodeExecution" DROP COLUMN "nodeType_old";

-- ── New columns on Node ────────────────────────────────────────────────
ALTER TABLE "Node" ADD COLUMN "typeVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Node" ADD COLUMN "disabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Node" ADD COLUMN "notes" TEXT;

-- ── Drop enum ──────────────────────────────────────────────────────────
DROP TYPE "NodeType";
