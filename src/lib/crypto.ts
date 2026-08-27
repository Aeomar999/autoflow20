import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Envelope encryption for credentials (AF-M3-01).
 *
 *   plaintext --AES-256-GCM--> ciphertext   (per-record DEK)
 *   DEK       --AES-256-GCM--> wrappedDek    (KEK from CREDENTIAL_MASTER_KEY)
 *   stored:   ciphertext, iv, authTag, wrappedDek, keyVersion
 *
 * Reasons for envelope (per docs/architecture/security.md §3): key rotation
 * becomes a re-wrap of the small DEKs instead of re-encrypting every payload,
 * and moving the KEK to a KMS/HSM is a change to one function.
 *
 * The KEK never lives in the database, in the repo, or in a log. This module
 * never logs anything - plaintext exists only in memory inside the call.
 */

/** Current KEK generation. Bump on rotation; old versions stay decryptable. */
export const CURRENT_KEY_VERSION = 1;

export interface CredentialEnvelope {
  /** Key version that wrapped the DEK (drives rotation re-wraps). */
  v: number;
  /** base64 IV — 12-byte AES-GCM nonce. */
  iv: string;
  /** base64 AES-256-GCM ciphertext of the credential value. */
  ct: string;
  /** base64 AES-256-GCM auth tag. */
  tag: string;
  /**
   * base64 frame of the KEK-wrapped DEK: `iv(12) | authTag(16) | ciphertext(32)`.
   * Encapsulating the wrap frame keeps the stored shape to the five fields in
   * the spec (ciphertext, iv, authTag, wrappedDek, keyVersion).
   */
  dek: string;
}

/** `keyVersion -> KEK`. Pass current + N-1 generations during rotation. */
export type CredentialKeyRing = ReadonlyMap<number, Buffer>;

/**
 * Reads and validates `CREDENTIAL_MASTER_KEY` from the environment.
 * [HARD] The key is 32 bytes, base64-encoded; the app refuses to boot
 * without a valid one (see instrumentation.ts).
 */
export function assertCredentialMasterKey(raw?: string): Buffer {
  const candidate = raw;
  if (!candidate) {
    throw new Error(
      "CREDENTIAL_MASTER_KEY is not set: the app refuses to boot without it.",
    );
  }

  let bytes: Buffer;
  try {
    bytes = Buffer.from(candidate, "base64");
  } catch {
    throw new Error(
      "CREDENTIAL_MASTER_KEY is not valid base64: must be 32 bytes, base64-encoded.",
    );
  }

  if (bytes.length !== 32) {
    throw new Error(
      `CREDENTIAL_MASTER_KEY must decode to 32 bytes (got ${bytes.length}). ` +
        "Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
    );
  }

  return bytes;
}

const loadMasterKey = (masterKey?: Buffer): Buffer =>
  masterKey ?? assertCredentialMasterKey(process.env.CREDENTIAL_MASTER_KEY);

const encryptWith = (
  plaintext: Buffer,
  key: Buffer,
): { iv: Buffer; ct: Buffer; tag: Buffer } => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { iv, ct, tag: cipher.getAuthTag() };
};

const decryptWith = (
  ct: Buffer,
  key: Buffer,
  iv: Buffer,
  tag: Buffer,
): Buffer => {
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
};

const wrapDek = (
  dek: Buffer,
  kek: Buffer,
): { iv: Buffer; wrapped: Buffer; tag: Buffer } => {
  const { iv, ct, tag } = encryptWith(dek, kek);
  return { iv, wrapped: ct, tag };
};

const DEK_FRAME_LEN = 12 + 16 + 32;

const unwrapDek = (
  envelope: Pick<CredentialEnvelope, "dek">,
  kek: Buffer,
): Buffer => {
  const frame = Buffer.from(envelope.dek, "base64");
  if (frame.length !== DEK_FRAME_LEN) {
    throw new Error(
      "credential decryption failed: malformed wrapped DEK frame.",
    );
  }
  return decryptWith(
    frame.subarray(28),
    kek,
    frame.subarray(0, 12),
    frame.subarray(12, 28),
  );
};

/**
 * Encrypts a credential value under a fresh random DEK, wrapped by the KEK.
 * New writes always use `CURRENT_KEY_VERSION` with the current master key.
 */
export function encryptCredential(
  plaintext: string,
  masterKey?: Buffer,
): CredentialEnvelope {
  const kek = loadMasterKey(masterKey);
  const dek = randomBytes(32);
  const { iv, ct, tag } = encryptWith(Buffer.from(plaintext, "utf8"), dek);
  const wrapped = wrapDek(dek, kek);

  return {
    v: CURRENT_KEY_VERSION,
    iv: iv.toString("base64"),
    ct: ct.toString("base64"),
    tag: tag.toString("base64"),
    dek: Buffer.concat([wrapped.iv, wrapped.tag, wrapped.wrapped]).toString(
      "base64",
    ),
  };
}

const resolveKek = (
  envelope: Pick<CredentialEnvelope, "v">,
  keyRing?: CredentialKeyRing,
): Buffer => {
  if (keyRing) {
    const kek = keyRing.get(envelope.v);
    if (!kek) {
      throw new Error(
        `credential decryption failed: unknown keyVersion ${envelope.v}. ` +
          "Supply a key ring covering all generations during the rotation window.",
      );
    }
    return kek;
  }
  if (envelope.v === CURRENT_KEY_VERSION) {
    return loadMasterKey();
  }
  throw new Error(
    `credential decryption failed: unknown keyVersion ${envelope.v}. ` +
      "Supply a key ring covering all generations during the rotation window.",
  );
};

/**
 * Decrypts an envelope. [HARD] GCM auth tags are verified: a tampered
 * ciphertext or a wrong key fails loudly and never degrades to plaintext.
 * The message stays generic to avoid acting as a decryption oracle.
 *
 * Older envelopes decrypt when a `keyRing` (N-1 generations) is supplied.
 */
export function decryptCredential(
  envelope: CredentialEnvelope,
  keyRing?: CredentialKeyRing,
): string {
  const kek = resolveKek(envelope, keyRing);
  try {
    const dek = unwrapDek(envelope, kek);
    const plaintext = decryptWith(
      Buffer.from(envelope.ct, "base64"),
      dek,
      Buffer.from(envelope.iv, "base64"),
      Buffer.from(envelope.tag, "base64"),
    );
    return plaintext.toString("utf8");
  } catch {
    throw new Error(
      "credential decryption failed: bad key, tampered ciphertext or malformed envelope.",
    );
  }
}

/**
 * Re-wraps an existing envelope's DEK under a newer KEK without decrypting
 * the payload - the rolling-rotation path. The stored ciphertext/iv/tag are
 * untouched; only `dek` (and `v`) change.
 */
export function rewrapCredential(
  envelope: CredentialEnvelope,
  sourceRing: CredentialKeyRing,
  targetVersion: number,
  targetMasterKey?: Buffer,
): CredentialEnvelope {
  const targetKek = targetMasterKey ?? loadMasterKey();
  const dek = unwrapDek(envelope, resolveKek(envelope, sourceRing));
  const wrapped = wrapDek(dek, targetKek);

  return {
    ...envelope,
    v: targetVersion,
    dek: Buffer.concat([wrapped.iv, wrapped.tag, wrapped.wrapped]).toString(
      "base64",
    ),
  };
}
