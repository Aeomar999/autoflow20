-- Better Auth 1.7 (upgraded from 1.3) writes an `issuer` on every account row
-- and keys accounts by (issuer, accountId). The column was never added here, so
-- Prisma rejected the credential insert with `Unknown argument 'issuer'`:
-- sign-up created the user row, failed on the account row, and left a user who
-- could not sign in and could not sign up again ("user already exists").
--
-- Additive and guarded (IF NOT EXISTS) to stay replayable, matching the other
-- additive migrations. Physical name follows Prisma @@map ("account").

ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "issuer" TEXT;

-- Backfill what Better Auth would have written: password accounts carry
-- "local:credential", social ones "local:oauth:<providerId>".
UPDATE "account"
   SET "issuer" = CASE
     WHEN "providerId" = 'credential' THEN 'local:credential'
     ELSE 'local:oauth:' || "providerId"
   END
 WHERE "issuer" IS NULL;

ALTER TABLE "account" ALTER COLUMN "issuer" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "account_issuer_accountId_key"
    ON "account"("issuer", "accountId");
