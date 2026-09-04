-- AF-M10-05 (H5) / ADR-0024. Per-trigger cursor state.
--
-- 18 of M10's 35 reference automations begin with "when a new X appears" —
-- a new sheet row, a new unread mail, a new file in a Drive folder. Answering
-- that needs somewhere to remember what "already appeared" means, and nothing
-- in the schema could express it: `evaluate-schedules` dispatched whole
-- workflows on a cron and kept no state at all.
--
-- One row per (workflow, node). Every column here is owned by the polling
-- framework — a poller returns items and a cursor and never writes this table
-- — so "have we already dispatched this?" has one implementation rather than
-- one per connector, each with its own off-by-one.
--
-- `lastSeenIds` is what makes at-least-once delivery safe. Providers answer
-- "modified since T" inclusively, so consecutive polls overlap; without the
-- id window a retried or overlapping poll double-dispatches, and the user sees
-- two invoices for one order.
--
-- `nextPollAt` + `failureCount` bound the damage of a broken credential: a
-- poller that fails backs off instead of being retried every minute for the
-- rest of the month.
--
-- Additive; no existing table is altered and no backfill is needed. Guarded
-- (IF NOT EXISTS) to stay replayable, matching the other additive migrations
-- in this directory.
CREATE TABLE IF NOT EXISTS "TriggerState" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "cursor" JSONB,
    "lastSeenIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastPolledAt" TIMESTAMP(3),
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextPollAt" TIMESTAMP(3),
    "keyFingerprint" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TriggerState_pkey" PRIMARY KEY ("id")
);

-- The uniqueness that makes the row addressable, and the two lookups the
-- sweep does: "whose turn is it?" and tenant-scoped reads.
CREATE UNIQUE INDEX IF NOT EXISTS "TriggerState_workflowId_nodeId_key"
    ON "TriggerState"("workflowId", "nodeId");
CREATE INDEX IF NOT EXISTS "TriggerState_organizationId_idx"
    ON "TriggerState"("organizationId");
CREATE INDEX IF NOT EXISTS "TriggerState_nextPollAt_idx"
    ON "TriggerState"("nextPollAt");

-- Cascades match the parents' lifetimes: deleting a workflow or an org must
-- not leave cursor rows pointing at nothing.
DO $$
BEGIN
    ALTER TABLE "TriggerState" ADD CONSTRAINT "TriggerState_workflowId_fkey"
        FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "TriggerState" ADD CONSTRAINT "TriggerState_organizationId_fkey"
        FOREIGN KEY ("organizationId") REFERENCES "organization"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
