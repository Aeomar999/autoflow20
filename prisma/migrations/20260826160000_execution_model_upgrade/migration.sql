-- AF-M2-01: Execution data model upgrade. Additive only — no existing
-- columns are removed or renamed. Existing rows get safe defaults.

-- 1. Extend ExecutionStatus enum with terminal states from the engine spec.
ALTER TYPE "ExecutionStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';
ALTER TYPE "ExecutionStatus" ADD VALUE IF NOT EXISTS 'TIMED_OUT';

-- 2. Execution: add trigger, mode, graphSnapshot, input, aggregates, durationMs.
ALTER TABLE "Execution" ADD COLUMN "trigger" TEXT NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "Execution" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'PRODUCTION';
ALTER TABLE "Execution" ADD COLUMN "graphSnapshot" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "Execution" ADD COLUMN "input" JSONB;
ALTER TABLE "Execution" ADD COLUMN "durationMs" INTEGER;
ALTER TABLE "Execution" ADD COLUMN "nodeCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Execution" ADD COLUMN "tokensIn" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Execution" ADD COLUMN "tokensOut" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Execution" ADD COLUMN "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- 3. Execution: indices for list queries.
CREATE INDEX "Execution_workflowId_startedAt_idx" ON "Execution"("workflowId", "startedAt" DESC);
CREATE INDEX "Execution_status_idx" ON "Execution"("status");

-- 4. NodeExecution: add nodeName, typeVersion, input, output, skipReason, aggregates.
ALTER TABLE "NodeExecution" ADD COLUMN "nodeName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "NodeExecution" ADD COLUMN "typeVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "NodeExecution" ADD COLUMN "input" JSONB;
ALTER TABLE "NodeExecution" ADD COLUMN "output" JSONB;
ALTER TABLE "NodeExecution" ADD COLUMN "skipReason" TEXT;
ALTER TABLE "NodeExecution" ADD COLUMN "tokensIn" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "NodeExecution" ADD COLUMN "tokensOut" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "NodeExecution" ADD COLUMN "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- 5. NodeExecution: additional indices.
CREATE INDEX "NodeExecution_executionId_startedAt_idx" ON "NodeExecution"("executionId", "startedAt" DESC);
CREATE INDEX "NodeExecution_status_idx" ON "NodeExecution"("status");
