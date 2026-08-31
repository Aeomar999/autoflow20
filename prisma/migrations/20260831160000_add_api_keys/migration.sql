-- AF-M8-01: Public REST API keys.
--
-- Additive only. Only the token hash + an 8-char support-lookup prefix are
-- stored; the full `af_...` secret is shown once at creation and never
-- persisted. Scopes is a comma-joined string set (open set - never an enum).
--
-- Guarded (IF NOT EXISTS) to stay replayable, matching the other additive
-- migrations. Physical names follow Prisma @@map: `organization` and `user`
-- are lowercase; the table itself maps to `api_key`.

CREATE TABLE IF NOT EXISTS "api_key" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "scopes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "organizationId" TEXT NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "api_key_pkey" PRIMARY KEY ("id")
);

-- The hash is the lookup key and the prefix is for support lookups; both are
-- unique so an attacker replaying a raw token always resolves to one row.
CREATE UNIQUE INDEX IF NOT EXISTS "api_key_prefix_key" ON "api_key"("prefix");
CREATE UNIQUE INDEX IF NOT EXISTS "api_key_hash_key" ON "api_key"("hash");
CREATE INDEX IF NOT EXISTS "api_key_organizationId_idx" ON "api_key"("organizationId");

-- Cascade on org delete (a key cannot outlive its tenant), set-null on the
-- creating user (an org key survives a member leaving).
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
