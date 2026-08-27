/**
 * AF-M3-02 one-shot data migration: re-encrypt pre-vault `Credential` rows
 * (Cryptr ciphertext in `value`) into the envelope columns, and map the old
 * `CredentialType` enum values to credential-registry ids before the
 * destructive migration `20260827170000_credential_vault_af_m3_02` drops
 * `value`.
 *
 * RUN ORDER (per docs/operations/environment_setup.md):
 *   1. npm run migrate:credentials          ← once, on the OLD schema
 *   2. prisma migrate deploy                 ← applies the vault migration
 *
 * On a database that already has the envelope schema (no `value` column) the
 * script detects that and exits cleanly.
 *
 * Usage:  npm run migrate:credentials [-- --yes]
 * `--yes` writes; without it the script only prints what it would do.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import Cryptr from "cryptr";
import { maskSecretValue } from "@/features/credentials/credential-types";
import { PrismaClient } from "@/generated/prisma/client";
import {
  assertCredentialMasterKey,
  encryptCredential,
  envelopeToColumns,
} from "@/lib/crypto";

const LEGACY_TYPE_TO_REGISTRY_ID: Record<string, string> = {
  OPENAI: "openai.apiKey",
  ANTHROPIC: "anthropic.apiKey",
  GEMINI: "gemini.apiKey",
};

async function main() {
  const shouldWrite = process.argv.includes("--yes");
  const legacyKey = process.env.ENCRYPTION_KEY;
  const masterKey = assertCredentialMasterKey(
    process.env.CREDENTIAL_MASTER_KEY,
  );

  if (!legacyKey || legacyKey.length < 32) {
    throw new Error(
      "ENCRYPTION_KEY (legacy Cryptr key, >= 32 chars) is required to decrypt pre-AF-M3-02 rows.",
    );
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  const legacy = new Cryptr(legacyKey);
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });

  const schemaHasValue =
    await prisma.$queryRaw`SELECT "value" FROM "Credential" LIMIT 1`
      .then(() => true)
      .catch(() => false);

  if (!schemaHasValue) {
    console.log(
      "Credential table already uses the envelope schema (no `value` column) — nothing to migrate.",
    );
    await prisma.$disconnect();
    return;
  }

  const rows = await prisma.$queryRaw<
    Array<{ id: string; type: string; value: string }>
  >`SELECT id, "type", "value" FROM "Credential"`;

  if (rows.length === 0) {
    console.log("No credentials to migrate.");
    await prisma.$disconnect();
    return;
  }

  for (const row of rows) {
    const registryId = LEGACY_TYPE_TO_REGISTRY_ID[row.type];
    if (!registryId) {
      throw new Error(
        `Row ${row.id} has unknown legacy type "${row.type}" — add it to LEGACY_TYPE_TO_REGISTRY_ID before re-running.`,
      );
    }

    let secret: string;
    try {
      secret = legacy.decrypt(row.value);
    } catch {
      throw new Error(
        `Row ${row.id}: legacy value is not a valid Cryptr ciphertext for the configured ENCRYPTION_KEY. ` +
          "Fix the key or stop — the destructive migration will otherwise lose this credential permanently.",
      );
    }

    const payload = JSON.stringify({ apiKey: secret });
    const columns = envelopeToColumns(encryptCredential(payload, masterKey));

    if (shouldWrite) {
      await prisma.$executeRaw`
        UPDATE "Credential"
        SET "type" = ${registryId},
            "ciphertext" = ${columns.ciphertext},
            "iv" = ${columns.iv},
            "authTag" = ${columns.authTag},
            "wrappedDek" = ${columns.wrappedDek},
            "keyVersion" = ${columns.keyVersion},
            "preview" = ${maskSecretValue(secret)}
        WHERE "id" = ${row.id}
      `;
    }

    console.log(
      `${shouldWrite ? "[WROTE]" : "[would]"} ${row.id} ${row.type} -> ${registryId} (${maskSecretValue(secret)})`,
    );
  }

  await prisma.$disconnect();

  if (!shouldWrite) {
    console.log(
      "\nDry run complete (no writes). Re-run with `-- --yes` to apply.",
    );
    return;
  }
  console.log(
    `Migrated ${rows.length} credential(s). Now apply the schema migration: prisma migrate deploy`,
  );
}

main().catch((error) => {
  console.error("migrate-credentials failed:", error.message);
  process.exit(1);
});
