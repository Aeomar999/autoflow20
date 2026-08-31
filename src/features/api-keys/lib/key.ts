import { createHash, randomBytes } from "node:crypto";

/**
 * Public REST API key material (AF-M8-01).
 *
 * Pure + isomorphic by design (mirrors `src/lib/quotas.ts`): token generation
 * and hashing never touch the DB, so the whole module is unit-testable in
 * isolation and safe to share between the management router and the REST auth
 * layer.
 *
 * A key is `af_` + 40 random base62 chars. Only the SHA-256 of that full
 * token and an 8-char support-lookup prefix are ever persisted - the secret
 * itself is shown once at creation and cannot be recovered from storage.
 */

export const API_KEY_PREFIX = "af_";

/** Random secret length in base62 characters. 40 chars ≈ 238 bits of entropy. */
export const API_KEY_SECRET_CHARS = 40;

/** Leading secret characters kept for support lookups (never enough to
 * brute-force the remainder). */
export const API_KEY_LOOKUP_PREFIX_CHARS = 8;

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** Deployed scope set. Open-ended: unknown scopes on a stored key are ignored
 * rather than treated as a parse error, so future additive scopes never break
 * an existing key (ADR-0012 §2). */
export const KNOWN_API_KEY_SCOPES = [
  "workflows:read",
  "workflows:execute",
  "executions:read",
  "executions:write",
] as const;

export type ApiKeyScope = (typeof KNOWN_API_KEY_SCOPES)[number];

/** True for any currently-issued scope. Unknown strings are rejected at
 * creation, but tolerated on a stored key. */
export function isKnownApiKeyScope(value: string): value is ApiKeyScope {
  return (KNOWN_API_KEY_SCOPES as readonly string[]).includes(value);
}

/** Unbiased base-62 random string. Digits are rejection-sampled per byte so
 * every digit is equally likely (no modulo bias). */
export function randomBase62(length: number): string {
  const MAX_ACCEPT = 62 * 4; // 248: the largest multiple of 62 that fits a byte
  const out: string[] = [];
  while (out.length < length) {
    const byte = randomBytes(1)[0];
    if (byte < MAX_ACCEPT) {
      out.push(BASE62[byte % 62]);
    }
  }
  return out.join("");
}

/** The full presentation token, as a client would send it in `Bearer`. */
export function buildApiKeySecret(randomPart: string): string {
  return `${API_KEY_PREFIX}${randomPart}`;
}

/** SHA-256 of the full token - the persisted lookup value. */
export function hashApiKey(fullToken: string): string {
  return createHash("sha256").update(fullToken).digest("hex");
}

/** First N chars of the random part, kept for support lookups. */
export function lookupPrefix(randomPart: string): string {
  return randomPart.slice(0, API_KEY_LOOKUP_PREFIX_CHARS);
}

/** Generate a fresh key. Only `prefix` and `hash` should ever be stored. */
export function generateApiKey(): {
  secret: string;
  prefix: string;
  hash: string;
} {
  const randomPart = randomBase62(API_KEY_SECRET_CHARS);
  const secret = buildApiKeySecret(randomPart);
  return {
    secret,
    prefix: lookupPrefix(randomPart),
    hash: hashApiKey(secret),
  };
}

const SCOPE_SEPARATOR = ",";

/** Join a scope set into the comma-separated storage form (sorted, deduped). */
export function serializeScopes(scopes: Iterable<string>): string {
  return [...new Set(scopes)].sort().join(SCOPE_SEPARATOR);
}

/** Split the comma-separated storage form back into a set. Empty-safe. */
export function parseScopes(raw: string): string[] {
  return raw
    .split(SCOPE_SEPARATOR)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** True when the stored raw string contains the given scope. */
export function hasScope(rawScopes: string, scope: ApiKeyScope): boolean {
  return parseScopes(rawScopes).includes(scope);
}
