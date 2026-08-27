import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  assertCredentialMasterKey,
  CURRENT_KEY_VERSION,
  decryptCredential,
  encryptCredential,
  rewrapCredential,
} from "./crypto";

const key1 = randomBytes(32);
const key2 = randomBytes(32);
const ring = (k1 = key1, k2 = key2) =>
  new Map<number, Buffer>([
    [1, k1],
    [2, k2],
  ]);

describe("assertCredentialMasterKey", () => {
  it("accepts base64 of exactly 32 bytes", () => {
    expect(
      assertCredentialMasterKey(key1.toString("base64")).equals(key1),
    ).toBe(true);
  });

  it("rejects a missing key", () => {
    expect(() => assertCredentialMasterKey()).toThrow(/refuses to boot/);
  });

  it("rejects keys that are not 32 bytes", () => {
    expect(() =>
      assertCredentialMasterKey(Buffer.alloc(16).toString("base64")),
    ).toThrow(/32 bytes/);
  });

  it("rejects strings that are not base64", () => {
    expect(() => assertCredentialMasterKey("!!not-base64!!")).toThrow();
  });
});

describe("encryptCredential / decryptCredential", () => {
  it("round-trips credentials losslessly", () => {
    const secret = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz";
    expect(decryptCredential(encryptCredential(secret, key1), ring())).toBe(
      secret,
    );
  });

  it("round-trips unicode and multiline values", () => {
    const secret = "dune line 1\n雪とクリームスマシン\x00binary-ish";
    expect(decryptCredential(encryptCredential(secret, key1), ring())).toBe(
      secret,
    );
  });

  it("never leaves plaintext in the envelope", () => {
    const secret = "never-leak-me";
    const envelope = encryptCredential(secret, key1);
    expect(JSON.stringify(envelope)).not.toContain(secret);
  });

  it("fails loudly on a tampered ciphertext", () => {
    const envelope = encryptCredential("secret", key1);
    const flipped = Buffer.from(envelope.ct, "base64");
    flipped[5] ^= 0xff;
    expect(() =>
      decryptCredential(
        { ...envelope, ct: flipped.toString("base64") },
        ring(),
      ),
    ).toThrow(/decryption failed/);
  });

  it("fails loudly on a tampered auth tag", () => {
    const envelope = encryptCredential("secret", key1);
    const flipped = Buffer.from(envelope.tag, "base64");
    flipped[0] ^= 0xff;
    expect(() =>
      decryptCredential(
        { ...envelope, tag: flipped.toString("base64") },
        ring(),
      ),
    ).toThrow(/decryption failed/);
  });

  it("fails loudly when the wrapped DEK is malformed", () => {
    const envelope = encryptCredential("secret", key1);
    expect(() =>
      decryptCredential({ ...envelope, dek: "c2hvcnQ=" }, ring()),
    ).toThrow(/malformed/);
  });

  it("fails loudly with the wrong key", () => {
    const envelope = encryptCredential("secret", key1);
    expect(() => decryptCredential(envelope, new Map([[1, key2]]))).toThrow(
      /decryption failed/,
    );
  });

  it("keeps the error message generic (no oracle)", () => {
    const envelope = encryptCredential("secret", key1);
    const flipped = Buffer.from(envelope.ct, "base64");
    flipped[0] ^= 0x01;
    let message = "";
    try {
      decryptCredential(
        { ...envelope, ct: flipped.toString("base64") },
        ring(),
      );
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toMatch(/auth tag|GCM|Buffer|error/i);
  });

  it("rejects an unknown keyVersion outside the ring", () => {
    const envelope = { ...encryptCredential("secret", key1), v: 99 };
    expect(() => decryptCredential(envelope, ring())).toThrow(/keyVersion 99/);
  });
});

describe("key rotation", () => {
  it("re-wraps from v1 to v2 and decrypts under the new ring", () => {
    const secret = "rotation-secret";
    let envelope = encryptCredential(secret, key1);
    expect(envelope.v).toBe(CURRENT_KEY_VERSION);

    envelope = rewrapCredential(envelope, ring(), 2, key2);
    expect(envelope.v).toBe(2);

    // N-1 ring (both generations) decrypts the re-wrapped envelope.
    expect(decryptCredential(envelope, ring())).toBe(secret);
    // Old envelopes stay decryptable with the retired key during the window.
    expect(decryptCredential(encryptCredential(secret, key1), ring())).toBe(
      secret,
    );
  });

  it("does not need the plaintext to re-wrap", () => {
    const secret = "re-wrap-without-plaintext";
    const original = encryptCredential(secret, key1);
    const rewrapped = rewrapCredential(original, ring(), 2, key2);
    expect(rewrapped.ct).toBe(original.ct);
    expect(decryptCredential(rewrapped, ring())).toBe(secret);
  });

  it("fails loudly when the source ring lacks the envelope's version", () => {
    const envelope = encryptCredential("secret", key1);
    expect(() =>
      rewrapCredential(envelope, new Map([[2, key2]]), 2, key2),
    ).toThrow(/keyVersion/);
  });
});
