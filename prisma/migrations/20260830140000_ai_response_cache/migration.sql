-- AF-M5-07: workspace-scoped AI response cache with TTL + hit-rate reporting.
--
-- Additive only. `AiResponseCache` holds one row per (organization, request
-- fingerprint); `NodeExecution.cacheHit` marks the runs the cache served, which
-- is what the hit-rate report counts against total cacheable AI node runs.
--
-- Guarded (IF NOT EXISTS) to stay replayable on databases that were populated
-- by an earlier `db push`, matching the AF-M7-pre-1 migrations.

-- 1. Cache table ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "AiResponseCache" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "cacheKey" TEXT NOT NULL,
    "nodeType" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "hitCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastHitAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiResponseCache_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'AiResponseCache_organizationId_fkey'
  ) THEN
    ALTER TABLE "AiResponseCache"
      ADD CONSTRAINT "AiResponseCache_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "organization"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- The lookup path: one row per workspace per request fingerprint.
CREATE UNIQUE INDEX IF NOT EXISTS "AiResponseCache_organizationId_cacheKey_key"
    ON "AiResponseCache"("organizationId", "cacheKey");

-- Reporting scans the newest entries for a workspace.
CREATE INDEX IF NOT EXISTS "AiResponseCache_organizationId_createdAt_idx"
    ON "AiResponseCache"("organizationId", "createdAt" DESC);

-- The daily sweep deletes by expiry across all workspaces.
CREATE INDEX IF NOT EXISTS "AiResponseCache_expiresAt_idx"
    ON "AiResponseCache"("expiresAt");

-- 2. Per-node cache attribution -------------------------------------------------
--
-- Nullable on purpose: NULL = the node ran with no cache configured, so it
-- counts as neither a hit nor a miss. Existing rows are correctly NULL.

ALTER TABLE "NodeExecution"
    ADD COLUMN IF NOT EXISTS "cacheHit" BOOLEAN;
