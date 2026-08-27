import { describe, expect, it } from "vitest";
import { credentialRegistry } from "../credential-registry";
import {
  type CredentialPublicRow,
  credentialPublicSchema,
  credentialPublicSelect,
  toPublicCredential,
} from "./serialize";

/**
 * Security contract for the credentials surface (security.md §3, AF-M3-02):
 * nothing that leaves the server for a credential is — or even may be —
 * the plaintext secret. The `.output(...)` schemas use `credentialPublicSchema`,
 * which is `.strict()` and enumerates only metadata. The tests below assert the
 * schema, the select, and the serializer stay closed against plaintext leaks.
 */

describe("credentialPublicSchema", () => {
  const seededPublic = () => ({
    id: "c_123",
    name: "My key",
    type: "openai.apiKey",
    kind: "apiKey",
    preview: "sk-a••••••1234",
    lastUsedAt: null,
    oauthExpiresAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-02T00:00:00Z"),
    usageCount: 3,
  });

  it("holds only metadata – no secret fields, no envelope columns", () => {
    const parsed = credentialPublicSchema.parse(seededPublic());
    for (const forbidden of [
      "value",
      "apiKey",
      "password",
      "accessToken",
      "ciphertext",
      "iv",
      "authTag",
      "wrappedDek",
      "keyVersion",
    ]) {
      expect(forbidden in parsed).toBe(false);
    }
  });

  it("rejects unknown keys with .strict() (no silent visibility)", () => {
    expect(() =>
      credentialPublicSchema.parse({
        ...seededPublic(),
        value: "sk-plaintext",
      }),
    ).toThrow(/Unrecognized key/);
    expect(() =>
      credentialPublicSchema.parse({
        ...seededPublic(),
        ciphertext: new Uint8Array(),
      }),
    ).toThrow(/Unrecognized key/);
  });

  it("rejects a payload that smuggles a plaintext secret field", () => {
    expect(() =>
      credentialPublicSchema.parse({ ...seededPublic(), apiKey: "sk-leak" }),
    ).toThrow(/Unrecognized key/);
  });

  it("rejects a raw DB row (missing public fields, carrying _count)", () => {
    expect(() => credentialPublicSchema.parse(rowFixture())).toThrow(
      /Unrecognized key/,
    );
  });

  it("requires the public type to be one of the registered ids", () => {
    expect(() =>
      credentialPublicSchema.parse({ ...seededPublic(), type: "OPENAI" }),
    ).toThrow();
  });
});

describe("credentialPublicSelect", () => {
  it("selects exactly the public columns and never ciphertext or plaintext", () => {
    const selected = new Set(Object.keys(credentialPublicSelect));
    for (const forbidden of [
      "value",
      "ciphertext",
      "iv",
      "authTag",
      "wrappedDek",
      "keyVersion",
    ]) {
      expect(selected.has(forbidden)).toBe(false);
    }
    for (const required of [
      "id",
      "name",
      "type",
      "preview",
      "lastUsedAt",
      "oauthExpiresAt",
      "createdAt",
      "updatedAt",
    ]) {
      expect(selected.has(required)).toBe(true);
    }
    expect(credentialPublicSelect._count).toEqual({ select: { Node: true } });
  });
});

const rowFixture = (): CredentialPublicRow => ({
  id: "c_1",
  name: "Anthropic prod",
  type: "anthropic.apiKey",
  preview: "sk-ant••••••zzzz",
  lastUsedAt: new Date("2026-02-01T00:00:00Z"),
  oauthExpiresAt: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  _count: { Node: 7 },
});

describe("toPublicCredential", () => {
  it("returns a validated CredentialPublic with kind and usage count", () => {
    const out = toPublicCredential(rowFixture());
    expect(out).toSatisfy(
      (v: unknown) => credentialPublicSchema.safeParse(v).success,
    );
    expect(out.kind).toBe("apiKey");
    expect(out.usageCount).toBe(7);
  });

  it("cannot leak a secret field even if the row carried one", () => {
    const leaky = {
      ...rowFixture(),
      apiKey: "sk-secret-should-never-escape",
    } as CredentialPublicRow;
    const out = toPublicCredential(leaky);
    expect(JSON.stringify(out)).not.toContain("sk-secret-should-never-escape");
  });

  it("maps kinds from the registry for every registered type", () => {
    for (const def of credentialRegistry.list()) {
      const out = toPublicCredential({ ...rowFixture(), type: def.type });
      expect(out.kind).toBe(def.kind);
    }
  });
});
