import "server-only";
import {
  type CredentialEnvelopeColumns,
  type CredentialKeyRing,
  columnsToEnvelope,
  decryptCredential,
  encryptCredential,
  envelopeToColumns,
} from "@/lib/crypto";

/**
 * Storage adapter between the envelope module (`src/lib/crypto.ts`) and the
 * `Credential` table's five hyphen-free columns (ciphertext, iv, authTag,
 * wrappedDek, keyVersion). The single place that touches encrypted credential
 * material outside the executors — both must go through here (security.md §3).
 */

/** Canonical secret object: `field.key -> value`, shape fixed by the def. */
export type CredentialSecret = Record<string, string>;

/** Encrypt the canonical secret into the five stored columns. */
export function sealSecret(
  secret: CredentialSecret,
  masterKey?: Buffer,
): CredentialEnvelopeColumns {
  return envelopeToColumns(
    encryptCredential(JSON.stringify(secret), masterKey),
  );
}

const asUint8 = (value: unknown, name: string): Uint8Array<ArrayBuffer> => {
  const ok =
    value instanceof Uint8Array ||
    Buffer.isBuffer(value) ||
    Array.isArray(value);
  if (!ok) {
    throw new Error(
      `credential decryption failed: ${name} is not byte data in the envelope.`,
    );
  }
  return Uint8Array.from(value);
};

/**
 * Decrypt the stored envelope back to the canonical secret. The row may come
 * straight from Prisma or be passed through a serialization boundary (Inngest
 * executors), so the byte columns are validated at runtime first. [HARD] GCM
 * auth tags are verified inside crypto.ts; a tampered ciphertext, wrong key
 * or unknown keyVersion fails loud. `keyRing` decrypts older KEK generations
 * during a rotation window.
 */
export function openSecret(
  row: unknown,
  keyRing?: CredentialKeyRing,
): CredentialSecret {
  if (row === null || typeof row !== "object") {
    throw new Error("credential decryption failed: missing envelope columns.");
  }
  const holder = row as Record<string, unknown>;
  if (typeof holder.keyVersion !== "number") {
    throw new Error(
      "credential decryption failed: missing keyVersion in envelope.",
    );
  }

  const plaintext = decryptCredential(
    columnsToEnvelope({
      keyVersion: holder.keyVersion,
      ciphertext: asUint8(holder.ciphertext, "ciphertext"),
      iv: asUint8(holder.iv, "iv"),
      authTag: asUint8(holder.authTag, "authTag"),
      wrappedDek: asUint8(holder.wrappedDek, "wrappedDek"),
    }),
    keyRing,
  );
  try {
    const parsed: unknown = JSON.parse(plaintext);
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      Object.values(parsed).some((v) => typeof v !== "string")
    ) {
      throw new Error("malformed");
    }
    return parsed as CredentialSecret;
  } catch {
    throw new Error(
      "credential decryption failed: payload is not a valid secret object.",
    );
  }
}
