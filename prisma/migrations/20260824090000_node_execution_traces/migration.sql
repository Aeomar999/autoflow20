-- Per-node execution traces (AF-A-05). Additive only: new enum, new table,
-- new relation column + index. No existing columns or rows are touched.

CREATE TYPE "NodeExecutionStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED', 'SKIPPED');

CREATE TABLE "NodeExecution" (
    "id" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "nodeType" "NodeType" NOT NULL,
    "status" "NodeExecutionStatus" NOT NULL DEFAULT 'RUNNING',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "order" INTEGER NOT NULL,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,

    CONSTRAINT "NodeExecution_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "NodeExecution_executionId_order_idx" ON "NodeExecution"("executionId", "order");

ALTER TABLE "NodeExecution" ADD CONSTRAINT "NodeExecution_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "Execution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
