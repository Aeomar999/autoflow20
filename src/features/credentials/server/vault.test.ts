import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { encryptCredential, envelopeToColumns } from "@/lib/crypto";
import { type CredentialSecret, openSecret, sealSecret } from "./vault";

describe("vault (envelope columns adapter)", () => {
  beforeAll(() => {
    process.env.CREDENTIAL_MASTER_KEY = randomBytes(32).toString("base64");
  });
  it("seals a secret into the five stored columns", () => {
    const columns = sealForTest({ apiKey: "sk-abc-very-long-secret-value" });
    expect(columns.keyVersion).toBe(1);
    for (const key of ["ciphertext", "iv", "authTag", "wrappedDek"] as const) {
      expect(columns[key]).toBeInstanceOf(Uint8Array);
      expect(columns[key].length).toBeGreaterThan(0);
    }
    // The plaintext never appears in the stored columns.
    const serialized = JSON.stringify({
      ciphertext: [...columns.ciphertext],
      iv: [...columns.iv],
      authTag: [...columns.authTag],
      wrappedDek: [...columns.wrappedDek],
    });
    expect(serialized).not.toContain("sk-abc-very-long-secret-value");
  });

  it("round-trips a canonical secret including unicode", () => {
    const secret: CredentialSecret = { apiKey: "sk-雪とクリーム" };
    expect(openSecret(sealForTest(secret))).toEqual(secret);
  });

  it("round-trips a multi-field secret (basic + oauth2)", () => {
    const basic: CredentialSecret = {
      username: "bob",
      password: "pw-12345678",
    };
    expect(openSecret(sealForTest(basic))).toEqual(basic);

    const oauth: CredentialSecret = {
      accessToken: "at-12345678",
      refreshToken: "rt-",
      scopes: "read write",
    };
    expect(openSecret(sealForTest(oauth))).toEqual(oauth);
  });

  it("fails loudly on a tampered ciphertext", () => {
    const columns = sealForTest({ apiKey: "sk-tamper-me-please" });
    const tampered = {
      ...columns,
      ciphertext: withFlippedByte(columns.ciphertext),
    };
    expect(() => openSecret(tampered)).toThrow(/decryption failed/);
  });

  it("fails loudly on a tampered auth tag", () => {
    const columns = sealForTest({ apiKey: "sk-tamper-me-please" });
    const tampered = { ...columns, authTag: withFlippedByte(columns.authTag) };
    expect(() => openSecret(tampered)).toThrow(/decryption failed/);
  });

  it("rejects a row without keyVersion", () => {
    const columns = sealForTest({ apiKey: "whatever-1234" });
    expect(() => openSecret({ ...columns, keyVersion: undefined })).toThrow(
      /keyVersion/,
    );
  });

  it("rejects byte columns that are not byte data", () => {
    const columns = sealForTest({ apiKey: "whatever-1234" });
    expect(() => openSecret({ ...columns, ciphertext: "not-bytes" })).toThrow(
      /not byte data/,
    );
  });

  it("rejects an envelope whose plaintext is not a secret object", () => {
    const columns = envelopeToColumns(encryptCredential("not-json-at-all"));
    expect(() => openSecret(columns)).toThrow(/not a valid secret object/);
  });

  it("rejects a plaintext object with a non-string value", () => {
    const columns = envelopeToColumns(
      encryptCredential(JSON.stringify({ apiKey: 42 })),
    );
    expect(() => openSecret(columns)).toThrow(/not a valid secret object/);
  });

  it("rejects a missing row outright", () => {
    expect(() => openSecret(null)).toThrow(/missing envelope columns/);
  });
});

function sealForTest(secret: CredentialSecret) {
  return sealSecret(secret);
}

function withFlippedByte(bytes: Uint8Array): Uint8Array {
  const copy = Uint8Array.from(bytes);
  copy[1] ^= 0xff;
  return copy;
}
