import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createCredentialRegistry,
  credentialRegistry,
  UnknownCredentialTypeError,
} from "./credential-registry";
import {
  CREDENTIAL_KINDS,
  CREDENTIAL_TYPE_DEFINITIONS,
  CREDENTIAL_TYPE_IDS,
  type CredentialTypeDef,
  computePreview,
  credentialManifest,
  maskSecretValue,
  secretFromInput,
} from "./credential-types";
import { credentialWriteVariants } from "./server/write-schema";

const validDef: CredentialTypeDef = {
  type: "test.apiKey",
  kind: "apiKey",
  label: "Test API key",
  description: "Fixture",
  fields: [{ key: "apiKey", label: "API key", secret: true }],
};

describe("createCredentialRegistry", () => {
  it("builds a registry from valid definitions", () => {
    const registry = createCredentialRegistry([validDef]);
    expect(registry.has("test.apiKey")).toBe(true);
    expect(registry.resolve("test.apiKey")).toBe(validDef);
    expect(registry.list()).toEqual([validDef]);
  });

  it("rejects duplicate type ids", () => {
    expect(() => createCredentialRegistry([validDef, validDef])).toThrow(
      /Duplicate credential type/,
    );
  });

  it("rejects an unknown kind", () => {
    expect(() =>
      createCredentialRegistry([{ ...validDef, kind: "token" as "apiKey" }]),
    ).toThrow(/invalid kind/);
  });

  it("rejects a definition without fields", () => {
    expect(() =>
      createCredentialRegistry([{ ...validDef, fields: [] }]),
    ).toThrow(/fields/);
  });

  it("rejects duplicate field keys", () => {
    expect(() =>
      createCredentialRegistry([
        {
          ...validDef,
          fields: [
            { key: "apiKey", label: "a", secret: true },
            { key: "apiKey", label: "b", secret: true },
          ],
        },
      ]),
    ).toThrow(/duplicate field key/);
  });

  it("rejects a definition with no secret field", () => {
    expect(() =>
      createCredentialRegistry([
        {
          ...validDef,
          fields: [{ key: "note", label: "Not secret", secret: false }],
        },
      ]),
    ).toThrow(/at least one field must be secret/);
  });

  it("rejects a tester registered for an unknown type", () => {
    expect(() =>
      createCredentialRegistry([validDef], {
        "ghost.type": async () => ({ ok: true }),
      }),
    ).toThrow(/unknown credential type/);
  });

  it("resolve() throws UnknownCredentialTypeError for unknown types", () => {
    const registry = createCredentialRegistry([validDef]);
    expect(() => registry.resolve("nope")).toThrow(UnknownCredentialTypeError);
    expect(() => registry.resolve("nope")).toThrow(
      /Registered types: test.apiKey/,
    );
  });

  it("tester() throws when no tester exists and isTestable is false", () => {
    const registry = createCredentialRegistry([validDef]);
    expect(registry.isTestable("test.apiKey")).toBe(false);
    expect(() => registry.tester("test.apiKey")).toThrow(/tester for/);
  });

  it("exposes registered testers", () => {
    const tester = async () => ({ ok: true }) as const;
    const registry = createCredentialRegistry([validDef], {
      "test.apiKey": tester,
    });
    expect(registry.isTestable("test.apiKey")).toBe(true);
    expect(registry.tester("test.apiKey")).toBe(tester);
  });
});

describe("credentialRegistry (built-in)", () => {
  it("registers exactly the documented type ids, all valid", () => {
    expect(
      credentialRegistry
        .list()
        .map((def) => def.type)
        .sort(),
    ).toEqual([...CREDENTIAL_TYPE_IDS].sort());
    for (const def of CREDENTIAL_TYPE_DEFINITIONS) {
      expect(credentialRegistry.has(def.type)).toBe(true);
      expect(CREDENTIAL_KINDS).toContain(def.kind);
      expect(def.fields.some((field) => field.secret)).toBe(true);
    }
  });

  it("exposes client-safe defs via credentialManifest", () => {
    expect(credentialManifest).toBe(CREDENTIAL_TYPE_DEFINITIONS);
  });

  it("exposes testers for the three migrated provider types only", () => {
    expect(credentialRegistry.isTestable("openai.apiKey")).toBe(true);
    expect(credentialRegistry.isTestable("anthropic.apiKey")).toBe(true);
    expect(credentialRegistry.isTestable("gemini.apiKey")).toBe(true);
    expect(credentialRegistry.isTestable("apiKey")).toBe(false);
  });
});

describe("write-schema <-> registry parity (anti-drift)", () => {
  it("has exactly one write variant per registered type", () => {
    const variantTypes = credentialWriteVariants.map(
      (variant) => variant.shape.type.value,
    );
    expect(variantTypes.sort()).toEqual([...CREDENTIAL_TYPE_IDS].sort());
  });

  it("matches each variant's field keys to its definition", () => {
    for (const variant of credentialWriteVariants) {
      const type = variant.shape.type.value;
      const def = credentialRegistry.resolve(type);
      const schemaKeys = Object.keys(variant.shape).filter((k) => k !== "type");
      const defKeys = def.fields.map((field) => field.key);

      for (const defKey of defKeys) {
        expect(schemaKeys).toContain(defKey);
      }
      // OAuth expiry only exists on oauth-kind credentials.
      if (def.oauth) {
        expect(schemaKeys).toContain("oauthExpiresAt");
      } else {
        expect(schemaKeys).not.toContain("oauthExpiresAt");
      }
      // No schema key may exist without a backing def field (or oauthExpiresAt).
      const allowed = new Set([
        ...defKeys,
        ...(def.oauth ? ["oauthExpiresAt"] : []),
      ]);
      for (const schemaKey of schemaKeys) {
        expect(allowed.has(schemaKey)).toBe(true);
      }
    }
  });

  it("accepts a valid payload through the write schema for each kind", () => {
    const samples: Array<{ type: string; payload: Record<string, unknown> }> = [
      { type: "apiKey", payload: { apiKey: "sk-abc" } },
      { type: "bearer", payload: { token: "tkn-123" } },
      { type: "basic", payload: { username: "u", password: "p" } },
      { type: "header", payload: { name: "X-Key", value: "v" } },
      { type: "oauth2", payload: { accessToken: "at", scopes: "read write" } },
      { type: "openai.apiKey", payload: { apiKey: "sk-xyz" } },
      { type: "anthropic.apiKey", payload: { apiKey: "sk-ant-xyz" } },
      { type: "gemini.apiKey", payload: { apiKey: "ai-zyx" } },
    ];
    const body = z.discriminatedUnion("type", credentialWriteVariants);
    for (const { type, payload } of samples) {
      const parsed = body.parse({ type, ...payload });
      expect(parsed.type).toBe(type);
    }
  });

  it("rejects a payload missing a required secret field", () => {
    const body = z.discriminatedUnion("type", credentialWriteVariants);
    expect(() => body.parse({ type: "apiKey" })).toThrow();
    expect(() => body.parse({ type: "basic", username: "u" })).toThrow();
  });

  it("rejects a payload leaking an unknown field", () => {
    const input = z
      .object({ name: z.string() })
      .and(z.discriminatedUnion("type", credentialWriteVariants));
    expect(() =>
      input.parse({ name: "x", type: "apiKey", apiKey: "k", value: "leak" }),
    ).toThrow(/Unrecognized key/);
  });
});

describe("secretFromInput / maskSecretValue / computePreview", () => {
  const oauthDef = credentialRegistry.resolve("oauth2");

  it("drops empty optional fields but keeps non-empty ones", () => {
    const secret = secretFromInput(oauthDef, {
      accessToken: "at",
      refreshToken: "",
      scopes: "  ",
    });
    expect(secret).toEqual({ accessToken: "at" });
  });

  it("keeps a populated optional field", () => {
    const secret = secretFromInput(oauthDef, {
      accessToken: "at",
      refreshToken: "rt",
      scopes: "read write",
    });
    expect(secret).toEqual({
      accessToken: "at",
      refreshToken: "rt",
      scopes: "read write",
    });
  });

  it("throws on a missing required field", () => {
    expect(() => secretFromInput(oauthDef, {})).toThrow(/accessToken/);
  });

  it("masks values without leaking the middle", () => {
    expect(maskSecretValue("sk-1234567890")).toBe("sk-1••••••7890");
    expect(maskSecretValue("short")).toBe("••••••••");
  });

  it("computePreview uses the first secret field", () => {
    const basic = credentialRegistry.resolve("basic");
    expect(
      computePreview(basic, { username: "bob", password: "hunter2hunter2" }),
    ).toBe(maskSecretValue("hunter2hunter2"));
    expect(computePreview(basic, { username: "bob", password: "" })).toBeNull();
  });
});
