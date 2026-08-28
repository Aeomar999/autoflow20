-- Credential vault reshape (AF-M3-02)
--
-- The single Cryptr ciphertext column (`value`) is replaced by the envelope
-- encryption columns from docs/architecture/security.md 3 and
-- docs/decisions/0004: ciphertext, iv, authTag, wrappedDek, keyVersion.
--
-- WARNING (run order): any database still holding pre-M3 Cryptr ciphertexts
-- in credential.value MUST run `scripts/migrate-credentials.ts` BEFORE
-- applying this migration, or those rows lose their payload. On empty/fresh
-- tables this migration is a no-op data-wise.

ALTER TABLE "Credential" DROP COLUMN "value";

ALTER TABLE "Credential" ADD COLUMN "ciphertext" BYTEA NOT NULL DEFAULT '\x'::bytea;
ALTER TABLE "Credential" ADD COLUMN "iv" BYTEA NOT NULL DEFAULT '\x'::bytea;
ALTER TABLE "Credential" ADD COLUMN "authTag" BYTEA NOT NULL DEFAULT '\x'::bytea;
ALTER TABLE "Credential" ADD COLUMN "wrappedDek" BYTEA NOT NULL DEFAULT '\x'::bytea;
ALTER TABLE "Credential" ADD COLUMN "keyVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Credential" ADD COLUMN "preview" TEXT;
ALTER TABLE "Credential" ADD COLUMN "oauthExpiresAt" TIMESTAMP(3);
ALTER TABLE "Credential" ADD COLUMN "lastUsedAt" TIMESTAMP(3);

ALTER TABLE "Credential" ALTER COLUMN "ciphertext" DROP DEFAULT;
ALTER TABLE "Credential" ALTER COLUMN "iv" DROP DEFAULT;
ALTER TABLE "Credential" ALTER COLUMN "authTag" DROP DEFAULT;
ALTER TABLE "Credential" ALTER COLUMN "wrappedDek" DROP DEFAULT;

-- type: CredentialType enum -> TEXT credential-registry ids (AF-M3-02)
ALTER TABLE "Credential" ALTER COLUMN "type" SET DATA TYPE TEXT USING ("type"::text);
UPDATE "Credential" SET "type" = 'openai.apiKey'    WHERE "type" = 'OPENAI';
UPDATE "Credential" SET "type" = 'anthropic.apiKey' WHERE "type" = 'ANTHROPIC';
UPDATE "Credential" SET "type" = 'gemini.apiKey'    WHERE "type" = 'GEMINI';
DROP TYPE "CredentialType";

CREATE INDEX "Credential_type_idx" ON "Credential"("type");
CREATE INDEX "Credential_oauthExpiresAt_idx" ON "Credential"("oauthExpiresAt");