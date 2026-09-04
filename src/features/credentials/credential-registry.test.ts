import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
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
import { openSecret, sealSecret } from "./server/vault";
import {
  credentialUpdateInput,
  credentialUpdateVariants,
  credentialWriteInput,
  credentialWriteVariants,
} from "./server/write-schema";

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

/**
 * Build a valid write payload for any def straight from its `fields`. Sample
 * payloads used to be listed by hand, one per type — the same duplication the
 * generated schema removed, and it silently skipped any type nobody added a
 * sample for.
 */
const samplePayload = (
  def: CredentialTypeDef,
  { includeOptional = true } = {},
): Record<string, string> => {
  const payload: Record<string, string> = {};
  for (const field of def.fields) {
    if (field.optional && !includeOptional) continue;
    payload[field.key] = `value-for-${def.type}-${field.key}`;
  }
  return payload;
};

describe("credentialRegistry (built-in)", () => {
  beforeAll(() => {
    // The vault refuses to seal without a master key; a random one per run is
    // enough for a round-trip assertion and never touches a real envelope.
    process.env.CREDENTIAL_MASTER_KEY = randomBytes(32).toString("base64");
  });

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

  it("exposes testers for connection-testable provider types only", () => {
    for (const type of [
      "openai.apiKey",
      "anthropic.apiKey",
      "gemini.apiKey",
      "airtable.apiKey",
      "hubspot.apiKey",
      "groq.apiKey",
      "deepseek.apiKey",
      "postgres",
      "smtp",
      // AF-M10-02
      "apify.apiKey",
      "apollo.apiKey",
      "mailerlite.apiKey",
      "pinecone.apiKey",
      "openrouter.apiKey",
      "creatomate.apiKey",
      "telegram.botToken",
      "uploadPost.apiKey",
      "waha.apiKey",
      "shopify.accessToken",
      "jira.apiToken",
    ]) {
      expect(
        credentialRegistry.isTestable(type),
        `${type} should have a connection tester`,
      ).toBe(true);
    }
    for (const type of ["apiKey", "openaiCompatible.apiKey"]) {
      expect(credentialRegistry.isTestable(type)).toBe(false);
    }
  });

  it("says WHY a type has no tester instead of leaving it silently untested", () => {
    // AF-M10-02's rule. "Nobody wired a tester" and "this provider has no
    // cheap authenticated GET" are indistinguishable in a registry — both are
    // simply an absent tester. Requiring a stated reason turns the second into
    // a decision and leaves the first failing here.
    for (const def of CREDENTIAL_TYPE_DEFINITIONS) {
      if (credentialRegistry.isTestable(def.type)) {
        expect(def.notTestableReason, `${def.type}`).toBeUndefined();
        continue;
      }
      expect(
        def.notTestableReason,
        `${def.type} has no tester and no notTestableReason`,
      ).toBeTruthy();
    }
  });

  it("declares a testable flag that matches whether a tester exists", () => {
    for (const def of CREDENTIAL_TYPE_DEFINITIONS) {
      const hasTester = credentialRegistry.isTestable(def.type);
      expect(def.testable === true, `${def.type}.testable`).toBe(hasTester);
    }
  });

  it("round-trips every type's secret through the vault (AF-M10-02)", () => {
    for (const def of CREDENTIAL_TYPE_DEFINITIONS) {
      const input = samplePayload(def);
      const secret = secretFromInput(def, input);
      const reopened = openSecret(sealSecret(secret));
      expect(reopened, `${def.type} did not survive seal → open`).toEqual(
        secret,
      );
    }
  });

  it("never leaks a raw secret field through computePreview", () => {
    for (const def of CREDENTIAL_TYPE_DEFINITIONS) {
      const secret = secretFromInput(def, samplePayload(def));
      const preview = computePreview(def, secret);
      if (preview === null) continue;
      for (const field of def.fields.filter((f) => f.secret)) {
        expect(
          preview.includes(secret[field.key]),
          `${def.type}.${field.key} appears verbatim in its preview`,
        ).toBe(false);
      }
    }
  });

  it("gives every type a brand mark and a describable label", () => {
    for (const def of CREDENTIAL_TYPE_DEFINITIONS) {
      expect(def.logo, `${def.type} has no logo`).toBeTruthy();
      expect(def.label.length).toBeGreaterThan(0);
      expect(def.description.length).toBeGreaterThan(0);
    }
  });
});

const writeBody = z.union(credentialWriteVariants);

describe("write-schema <-> registry parity (anti-drift)", () => {
  it("has exactly one write variant per registered type", () => {
    const variantTypes = credentialWriteVariants.map(
      (variant) => (variant.shape.type as z.ZodLiteral<string>).value,
    );
    expect(variantTypes.sort()).toEqual([...CREDENTIAL_TYPE_IDS].sort());
  });

  it("has exactly one update variant per registered type", () => {
    const variantTypes = credentialUpdateVariants.map(
      (variant) => (variant.shape.type as z.ZodLiteral<string>).value,
    );
    expect(variantTypes.sort()).toEqual([...CREDENTIAL_TYPE_IDS].sort());
  });

  it("matches each variant's field keys to its definition", () => {
    for (const variant of credentialWriteVariants) {
      const type = (variant.shape.type as z.ZodLiteral<string>).value;
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

  it("accepts a valid payload through the write schema for every type", () => {
    for (const def of CREDENTIAL_TYPE_DEFINITIONS) {
      const parsed = writeBody.parse({
        type: def.type,
        ...samplePayload(def),
      }) as { type: string };
      expect(parsed.type).toBe(def.type);
    }
  });

  it("accepts a payload with every optional field omitted", () => {
    for (const def of CREDENTIAL_TYPE_DEFINITIONS) {
      expect(() =>
        writeBody.parse({
          type: def.type,
          ...samplePayload(def, { includeOptional: false }),
        }),
      ).not.toThrow();
    }
  });

  it("rejects a payload missing a required secret field", () => {
    for (const def of CREDENTIAL_TYPE_DEFINITIONS) {
      const required = def.fields.filter((field) => !field.optional);
      if (required.length === 0) continue;
      const payload = samplePayload(def);
      delete payload[required[0].key];
      expect(
        () => writeBody.parse({ type: def.type, ...payload }),
        `${def.type} must require "${required[0].key}"`,
      ).toThrow();
    }
  });

  it("accepts a named payload through the real write input for every type", () => {
    for (const def of CREDENTIAL_TYPE_DEFINITIONS) {
      const parsed = credentialWriteInput.parse({
        name: "x",
        type: def.type,
        ...samplePayload(def),
      });
      // The `header` variant declares its own `name` field (the HTTP header
      // key); for every other kind the parse must keep the display name.
      const expectedName =
        def.type === "header" ? `value-for-${def.type}-name` : "x";
      expect(parsed).toMatchObject({ name: expectedName, type: def.type });
    }
  });

  it("rejects a payload leaking an unknown field through the real write input", () => {
    expect(() =>
      credentialWriteInput.parse({
        name: "x",
        type: "apiKey",
        apiKey: "k",
        value: "leak",
      }),
    ).toThrow(/Unrecognized key/);
    expect(() =>
      credentialWriteInput.parse({ name: "x", type: "apiKey", apiKey: "k" }),
    ).not.toThrow();
  });

  it("lets an update omit every secret field (rename-only)", () => {
    for (const def of CREDENTIAL_TYPE_DEFINITIONS) {
      expect(() =>
        credentialUpdateInput.parse({
          id: "cred_1",
          name: "renamed",
          type: def.type,
        }),
      ).not.toThrow();
    }
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
