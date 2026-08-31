-- AF-M7-pre-1: bring the organization subsystem into migration history.
--
-- The org tables/enums exist in schema.prisma but were never shipped as a
-- migration (the dev database was populated by an untracked `prisma db push`
-- from an earlier draft). Pristine `migrate deploy` databases had none of this.
-- This migration creates the subsystem per the CURRENT schema, guarded so it
-- no-ops on databases that already carry the tables.
--
-- Pre-existing drift that is NOT reconciled here (separate follow-up): dev has
-- `Workflow.workspaceId`, `organization.logo`, `invitation.inviterId`,
-- `invitation.status`, and lacks `invitation.invitedById` /
-- `approval_request.prompt` + `updatedAt`. Those predate AF-M7-pre-1.
--
-- Reconciliation included here, cheap and safe either direction: `workspace.slug`
-- (required by resolveActiveOrg) and `invitation.invitedById` (schema scalar).
-- Note: schema declares `invitation.invitedById` WITHOUT a relation, so Prisma
-- implies no FK for it; a pre-existing FK on dev is unmodeled and harmless.

-- 1. Enums ----------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'Role') THEN
    CREATE TYPE "Role" AS ENUM ('OWNER', 'ADMIN', 'EDITOR', 'VIEWER');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'Plan') THEN
    CREATE TYPE "Plan" AS ENUM ('FREE', 'STARTER', 'PRO', 'ENTERPRISE');
  END IF;
END $$;

-- A pre-existing "Plan" type predates the STARTER tier. DO NOT add the value if
-- it is already present (this must run today, and again for any DB pushed from a
-- draft that already knew about STARTER).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'Plan' AND e.enumlabel = 'STARTER'
  ) THEN
    ALTER TYPE "Plan" ADD VALUE 'STARTER';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ApprovalStatus') THEN
    CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'TIMED_OUT');
  END IF;
END $$;

-- 2. Tables ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "plan" "Plan" NOT NULL DEFAULT 'FREE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "member" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'EDITOR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "member_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "workspace" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "invitation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'EDITOR',
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "invitedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "audit_log" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actorId" TEXT,
    "actorType" TEXT NOT NULL DEFAULT 'USER',
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "approval_request" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "nodeName" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "prompt" TEXT,
    "comment" TEXT,
    "timeoutAt" TIMESTAMP(3) NOT NULL,
    "respondedById" TEXT,
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_request_pkey" PRIMARY KEY ("id")
);

-- 3. Workspace.slug reconciliation --------------------------------------------
-- dev's workspace table predates the slug column. resolveActiveOrg and the
-- org-scoped procedures insert workspaces with a slug, so bring dev in line
-- BEFORE the indexes below reference the column.
-- Clean databases get the column from the CREATE TABLE above and skip this.

ALTER TABLE "workspace" ADD COLUMN IF NOT EXISTS "slug" TEXT;

UPDATE "workspace" SET "slug" = 'default' WHERE "slug" IS NULL;

ALTER TABLE "workspace" ALTER COLUMN "slug" SET NOT NULL;

-- dev's invitation table also predates the inviter tracking column that the
-- invitation_invitedById_fkey below references.
ALTER TABLE "invitation" ADD COLUMN IF NOT EXISTS "invitedById" TEXT;

-- 4. Indexes ----------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS "organization_slug_key" ON "organization"("slug");

CREATE UNIQUE INDEX IF NOT EXISTS "member_organizationId_userId_key" ON "member"("organizationId", "userId");

CREATE UNIQUE INDEX IF NOT EXISTS "workspace_organizationId_slug_key" ON "workspace"("organizationId", "slug");

CREATE UNIQUE INDEX IF NOT EXISTS "invitation_token_key" ON "invitation"("token");
CREATE INDEX IF NOT EXISTS "invitation_organizationId_idx" ON "invitation"("organizationId");

CREATE INDEX IF NOT EXISTS "audit_log_organizationId_createdAt_idx" ON "audit_log"("organizationId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "audit_log_resourceType_resourceId_idx" ON "audit_log"("resourceType", "resourceId");

CREATE INDEX IF NOT EXISTS "approval_request_organizationId_status_idx" ON "approval_request"("organizationId", "status");

-- 4. Foreign keys (dbs pushed from the old draft may already carry equivalent
-- constraints under these names). --------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'member_organizationId_fkey' AND conrelid = 'member'::regclass) THEN
    ALTER TABLE "member" ADD CONSTRAINT "member_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'member_userId_fkey' AND conrelid = 'member'::regclass) THEN
    ALTER TABLE "member" ADD CONSTRAINT "member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_organizationId_fkey' AND conrelid = 'workspace'::regclass) THEN
    ALTER TABLE "workspace" ADD CONSTRAINT "workspace_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invitation_organizationId_fkey' AND conrelid = 'invitation'::regclass) THEN
    ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audit_log_organizationId_fkey' AND conrelid = 'audit_log'::regclass) THEN
    ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audit_log_actorId_fkey' AND conrelid = 'audit_log'::regclass) THEN
    ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'approval_request_organizationId_fkey' AND conrelid = 'approval_request'::regclass) THEN
    ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'approval_request_workflowId_fkey' AND conrelid = 'approval_request'::regclass) THEN
    ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'approval_request_executionId_fkey' AND conrelid = 'approval_request'::regclass) THEN
    ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "Execution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'approval_request_respondedById_fkey' AND conrelid = 'approval_request'::regclass) THEN
    ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_respondedById_fkey" FOREIGN KEY ("respondedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;