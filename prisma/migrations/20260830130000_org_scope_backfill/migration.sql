-- AF-M7-pre-1: backfill organizationId on Workflow / Credential / Execution and
-- harden Workflow ownership.
--
-- Organization-scoped access requires every workflow to belong to an organization
-- (hence NOT NULL). Credentials and executions keep an OPTIONAL organizationId
-- in the schema; they are backfilled here for tenant-scoping but not hardened.
--
-- Idempotent: dev was db-pushed from an earlier org draft, so the columns (but
-- not the data) may already exist.

-- 1. Columns --------------------------------------------------------------------

ALTER TABLE "Workflow" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "Credential" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "Execution" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;

-- 2. Backfill -------------------------------------------------------------------

-- Map every user to exactly one organization: their most privileged membership
-- (OWNER preferred), earliest joined on ties.
CREATE TEMP TABLE "tmp_user_org" (
    "userId" TEXT PRIMARY KEY,
    "organizationId" TEXT NOT NULL
);

INSERT INTO "tmp_user_org" ("userId", "organizationId")
SELECT DISTINCT ON (m."userId") m."userId", m."organizationId"
FROM "member" m
ORDER BY m."userId", CASE WHEN m."role" = 'OWNER' THEN 0 ELSE 1 END, m."createdAt";

-- Users who own workflows but hold no membership get a personal organization so
-- every workflow can be assigned. One org + OWNER member + default workspace.
DO $$
DECLARE
  u RECORD;
  oid TEXT;
BEGIN
  FOR u IN
    SELECT DISTINCT w."userId" AS "userId", us."name"
    FROM "Workflow" w
    JOIN "user" us ON us."id" = w."userId"
    LEFT JOIN "member" m ON m."userId" = w."userId"
    WHERE m."userId" IS NULL
  LOOP
    IF EXISTS (SELECT 1 FROM "tmp_user_org" WHERE "userId" = u."userId") THEN
      CONTINUE;
    END IF;

    oid := 'pers-' || u."userId";

    INSERT INTO "organization" ("id", "name", "slug", "plan", "createdAt", "updatedAt")
    VALUES (oid, COALESCE(NULLIF(u."name", ''), 'Personal Workspace') || ' Workspace',
            'personal-' || lower(u."userId"), 'FREE', NOW(), NOW())
    ON CONFLICT ("slug") DO NOTHING;

    -- A database that raced us may already carry the slug on a different id; adopt it.
    SELECT "id" INTO oid FROM "organization" WHERE "slug" = 'personal-' || lower(u."userId");

    INSERT INTO "member" ("id", "organizationId", "userId", "role", "createdAt", "updatedAt")
    VALUES ('mem-' || u."userId", oid, u."userId", 'OWNER', NOW(), NOW())
    ON CONFLICT DO NOTHING;

    INSERT INTO "workspace" ("id", "organizationId", "name", "slug", "createdAt", "updatedAt")
    VALUES ('ws-' || u."userId", oid, 'Default Workspace', 'default', NOW(), NOW())
    ON CONFLICT ("organizationId", "slug") DO NOTHING;

    INSERT INTO "tmp_user_org" ("userId", "organizationId") VALUES (u."userId", oid);
  END LOOP;
END $$;

-- Assign unassigned rows. Executions resolve their organization through their
-- workflow's owner.
UPDATE "Workflow" w
SET "organizationId" = t."organizationId"
FROM "tmp_user_org" t
WHERE w."userId" = t."userId"
  AND w."organizationId" IS NULL;

UPDATE "Credential" c
SET "organizationId" = t."organizationId"
FROM "tmp_user_org" t
WHERE c."userId" = t."userId"
  AND c."organizationId" IS NULL;

UPDATE "Execution" AS e
SET "organizationId" = v."organizationId"
FROM "Workflow" AS w
JOIN "tmp_user_org" AS v ON v."userId" = w."userId"
WHERE e."workflowId" = w."id"
  AND e."organizationId" IS NULL;

DROP TABLE "tmp_user_org";

-- 3. Harden Workflow ownership ----------------------------------------------------

-- Backfill above guarantees no NULLs remain from real data; an empty (fresh)
-- table trivially satisfies this too.
ALTER TABLE "Workflow" ALTER COLUMN "organizationId" SET NOT NULL;

-- 4. Indexes + foreign keys --------------------------------------------------------

CREATE INDEX IF NOT EXISTS "Workflow_organizationId_idx" ON "Workflow"("organizationId");
CREATE INDEX IF NOT EXISTS "Credential_organizationId_idx" ON "Credential"("organizationId");
CREATE INDEX IF NOT EXISTS "Execution_organizationId_idx" ON "Execution"("organizationId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Workflow_organizationId_fkey' AND conrelid = '"Workflow"'::regclass) THEN
    ALTER TABLE "Workflow" ADD CONSTRAINT "Workflow_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Credential_organizationId_fkey' AND conrelid = '"Credential"'::regclass) THEN
    ALTER TABLE "Credential" ADD CONSTRAINT "Credential_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Execution_organizationId_fkey' AND conrelid = '"Execution"'::regclass) THEN
    ALTER TABLE "Execution" ADD CONSTRAINT "Execution_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;