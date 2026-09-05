-- AF-M11-01. Employee lifecycle substrate (mega-workflow W1–W4 source of truth).
--
-- One org-scoped `Employee` row is the single source of truth for the four
-- phase workflows (W1 acquisition → W2 onboarding → W3 tenure → W4
-- offboarding). `employeeRef` is the stable business id (ATS / hire id) carried
-- through every handoff between phase workflows — the table's own `id` is
-- internal. `status` is a STRING on purpose, never a Postgres enum (repo rule:
-- no Postgres enum for an open set, the `NodeType` bug); the allowed chain
-- CANDIDATE → OFFERED → ONBOARDING → ACTIVE → OFFBOARDING → OFFBOARDED is
-- enforced in the app layer (`src/features/employees/`).
--
-- Additive; no existing table is altered and no backfill is needed. Guarded
-- (IF NOT EXISTS) to stay replayable, matching the other additive migrations
-- in this directory.
CREATE TABLE IF NOT EXISTS "employee" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeRef" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "department" TEXT,
    "managerEmail" TEXT,
    "personalEmail" TEXT,
    "startDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'CANDIDATE',
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "offerSignedAt" TIMESTAMP(3),
    "activeAt" TIMESTAMP(3),
    "exitDate" TIMESTAMP(3),
    "exitReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_pkey" PRIMARY KEY ("id")
);

-- Handoffs and de-dup key off the stable business id, per tenant.
CREATE UNIQUE INDEX IF NOT EXISTS "employee_organizationId_employeeRef_key"
    ON "employee"("organizationId", "employeeRef");

-- One employee identity per tenant email.
CREATE UNIQUE INDEX IF NOT EXISTS "employee_organizationId_email_key"
    ON "employee"("organizationId", "email");

-- Org list views filtered by lifecycle stage (W1–W4 dashboards).
CREATE INDEX IF NOT EXISTS "employee_organizationId_status_idx"
    ON "employee"("organizationId", "status");

DO $$
BEGIN
    ALTER TABLE "employee" ADD CONSTRAINT "employee_organizationId_fkey"
        FOREIGN KEY ("organizationId") REFERENCES "organization"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;