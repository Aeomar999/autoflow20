-- AF-M10-06 (H6) / ADR-0025. Binary payloads by reference.
--
-- 12 of M10's 35 reference automations move a PDF, an image or a video between
-- nodes. They cannot travel in `WorkflowContext`: it is JSON-serialized into
-- `NodeExecution.output` under the ADR-0018 per-node byte cap, so a 3 MB
-- invoice fails the run at the output boundary rather than reaching the next
-- node.
--
-- What travels is a `FileRef` — `{ $file: { id, filename, mimeType, size,
-- sha256 } }`, a few hundred bytes. This table is the id it points at; the
-- bytes live in the blob store (local filesystem in dev/CI, S3-compatible in
-- staging/prod).
--
-- `executionId` is the lifetime tie: the AF-M8-06 retention sweep already
-- deletes runs on a per-plan schedule, and a blob whose run is gone is
-- unreachable by definition. `ON DELETE SET NULL` rather than CASCADE is
-- deliberate — the row must survive its execution's deletion long enough for
-- the sweep to delete the OBJECT too, otherwise the database forgets a file
-- that is still occupying storage and paying for it.
--
-- `expiresAt` covers the other case: a file uploaded through an intake form
-- before any run exists has no execution to inherit a lifetime from.
--
-- Additive; no existing table is altered and no backfill is needed. Guarded
-- (IF NOT EXISTS) to stay replayable, matching the other additive migrations
-- in this directory.
CREATE TABLE IF NOT EXISTS "StoredFile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "executionId" TEXT,
    "workflowId" TEXT,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "backend" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoredFile_pkey" PRIMARY KEY ("id")
);

-- Tenant reads and the per-org quota sum; the retention sweep's two lookups;
-- and content-addressed reuse within one org.
CREATE INDEX IF NOT EXISTS "StoredFile_organizationId_idx"
    ON "StoredFile"("organizationId");
CREATE INDEX IF NOT EXISTS "StoredFile_executionId_idx"
    ON "StoredFile"("executionId");
CREATE INDEX IF NOT EXISTS "StoredFile_expiresAt_idx"
    ON "StoredFile"("expiresAt");
CREATE INDEX IF NOT EXISTS "StoredFile_organizationId_sha256_idx"
    ON "StoredFile"("organizationId", "sha256");

DO $$
BEGIN
    ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_organizationId_fkey"
        FOREIGN KEY ("organizationId") REFERENCES "organization"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_executionId_fkey"
        FOREIGN KEY ("executionId") REFERENCES "Execution"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
