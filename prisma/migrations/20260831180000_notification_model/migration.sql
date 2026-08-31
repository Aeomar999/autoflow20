-- AF-M7-08: in-app notification centre.
--
-- Additive only: a new enum, a new table, and two boolean columns on
-- `Workflow` carrying per-workflow delivery preferences.
--
-- `Notification` is tenant-scoped, like every other workspace table — there is
-- no per-user addressing in v1. A notification belongs to the workspace and
-- everyone who can see the workspace sees it, matching how executions and
-- approvals already behave.
--
-- Guarded (IF NOT EXISTS / pg_type lookup) to stay replayable, matching the
-- other additive migrations.

-- The enum type is created by Prisma as the case-preserving
-- "NotificationType"; `to_regtype` on a bare name would fold to lowercase and
-- miss it, so the guard checks pg_type by exact typname.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'NotificationType'
  ) THEN
    CREATE TYPE "NotificationType" AS ENUM (
      'EXECUTION_FAILED',
      'EXECUTION_SUCCEEDED',
      'APPROVAL_REQUESTED',
      'CREDENTIAL_EXPIRING',
      'SYSTEM'
    );
  END IF;
END $$;

-- Per-workflow delivery preferences. Failure defaults ON because a run that
-- broke is the thing people need told about; success defaults OFF because a
-- workflow on a five-minute cron would otherwise write 288 rows a day and make
-- the centre worthless. Existing workflows adopt both defaults.
ALTER TABLE "Workflow"
  ADD COLUMN IF NOT EXISTS "notifyOnFailure" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Workflow"
  ADD COLUMN IF NOT EXISTS "notifyOnSuccess" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "Notification" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "href" TEXT,
    "readAt" TIMESTAMP(3),
    -- Idempotency key. The runner tail can be replayed by Inngest and a cron
    -- can fire twice on a redeploy; writing through skipDuplicates on this key
    -- makes a retry a no-op instead of a duplicate row.
    "dedupeKey" TEXT NOT NULL,
    "workflowId" TEXT,
    -- Plain columns, not FKs: they build `href` and let a caller correlate.
    -- Keeping them FK-free means a pruned execution or a deleted credential
    -- leaves the notification history intact rather than erasing what was
    -- announced.
    "executionId" TEXT,
    "credentialId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Notification_dedupeKey_key"
  ON "Notification"("dedupeKey");

-- The centre's only read path: this org's rows, newest first.
CREATE INDEX IF NOT EXISTS "Notification_organizationId_createdAt_idx"
  ON "Notification"("organizationId", "createdAt" DESC);

-- The bell's unread count.
CREATE INDEX IF NOT EXISTS "Notification_organizationId_readAt_idx"
  ON "Notification"("organizationId", "readAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Notification_organizationId_fkey'
  ) THEN
    ALTER TABLE "Notification"
      ADD CONSTRAINT "Notification_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "organization"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Notification_workflowId_fkey'
  ) THEN
    ALTER TABLE "Notification"
      ADD CONSTRAINT "Notification_workflowId_fkey"
      FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
