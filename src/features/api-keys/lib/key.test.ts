import { describe, expect, it } from "vitest";
import {
  API_KEY_PREFIX,
  API_KEY_SECRET_CHARS,
  buildApiKeySecret,
  generateApiKey,
  hashApiKey,
  hasScope,
  isKnownApiKeyScope,
  lookupPrefix,
  parseScopes,
  randomBase62,
  serializeScopes,
} from "./key";

describe("randomBase62", () => {
  it("produces the requested length", () => {
    expect(randomBase62(20)).toHaveLength(20);
    expect(randomBase62(40)).toHaveLength(40);
  });

  it("only emits base62 characters", () => {
    const value = randomBase62(200);
    expect(value).toMatch(/^[0-9A-Za-z]+$/);
  });
});

describe("generateApiKey", () => {
  it("prepends the af_ prefix and produces the configured secret length", () => {
    const { secret, prefix } = generateApiKey();
    expect(secret.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(secret).toHaveLength(API_KEY_PREFIX.length + API_KEY_SECRET_CHARS);
    expect(secret).toMatch(/^af_[0-9A-Za-z]+$/);
    expect(prefix).toHaveLength(8);
  });

  it("stores the hash of the full token, not the token", () => {
    const { secret, hash, prefix } = generateApiKey();
    expect(hashApiKey(secret)).toBe(hash);
    expect(hash).not.toContain(secret.slice(API_KEY_PREFIX.length));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(prefix).toBe(lookupPrefix(secret.slice(API_KEY_PREFIX.length)));
  });

  it("returns unique secrets", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const { secret } = generateApiKey();
      seen.add(secret);
    }
    expect(seen.size).toBe(50);
  });
});

describe("buildApiKeySecret / hashing", () => {
  it("hashes deterministically", () => {
    const random = randomBase62(40);
    const a = hashApiKey(buildApiKeySecret(random));
    const b = hashApiKey(buildApiKeySecret(random));
    expect(a).toBe(b);
  });

  it("a single-character change yields a different hash", () => {
    const a = hashApiKey(buildApiKeySecret("A".repeat(40)));
    const b = hashApiKey(buildApiKeySecret("B".repeat(40)));
    expect(a).not.toBe(b);
  });
});

describe("scopes", () => {
  it("serializeScopes sorts and de-dupes", () => {
    expect(
      serializeScopes(["executions:read", "workflows:read", "workflows:read"]),
    ).toBe("executions:read,workflows:read");
  });

  it("parseScopes splits, trims, and drops empties", () => {
    expect(parseScopes("workflows:read , , executions:write")).toEqual([
      "workflows:read",
      "executions:write",
    ]);
    expect(parseScopes("")).toEqual([]);
  });

  it("hasScope reports membership", () => {
    const raw = serializeScopes(["workflows:read", "executions:read"]);
    expect(hasScope(raw, "workflows:read")).toBe(true);
    expect(hasScope(raw, "executions:write")).toBe(false);
  });

  it("isKnownApiKeyScope accepts deployed scopes and rejects unknown", () => {
    expect(isKnownApiKeyScope("workflows:read")).toBe(true);
    expect(isKnownApiKeyScope("workflows:execute")).toBe(true);
    expect(isKnownApiKeyScope("future:scope")).toBe(false);
  });
});
