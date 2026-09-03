import "server-only";
import { NonRetriableError } from "inngest";
import type { CredentialSecret } from "@/features/credentials/server/vault";

/**
 * Credential → HTTP auth translation (AF-M10-01, ADR-0022).
 *
 * 31 of the 35 reference automations are ultimately an authenticated REST
 * call. Rather than one bespoke integration per service, `HTTP_REQUEST` binds
 * *any* registered credential type and this module turns the decrypted secret
 * into request material. Service node families reuse it so there is one place
 * that knows how a secret becomes an `Authorization` header.
 *
 * Two rules hold everywhere in here:
 *
 * 1. **The secret is read only from the resolved credential map** — never from
 *    node config. `NodeRunParams.credentials` is the AF-M3-04 injection path;
 *    node `data` is persisted into `NodeExecution.input`, so a secret that
 *    arrived through config would already be in the trace before this module
 *    ran.
 * 2. **No error message interpolates secret material.** A failure names the
 *    auth mode and the field keys it looked for, nothing else.
 */

export const HTTP_AUTH_MODES = [
  "none",
  "bearer",
  "header",
  "basic",
  "queryParam",
  "oauth2",
] as const;

export type HttpAuthMode = (typeof HTTP_AUTH_MODES)[number];

export interface HttpAuthOptions {
  /** Header name for `header` mode. Falls back to the secret's `name` field. */
  headerName?: string;
  /** Query parameter name for `queryParam` mode. Falls back to `name`, then `api_key`. */
  queryParamName?: string;
}

export interface AppliedHttpAuth {
  /** Headers to merge into the request. */
  headers: Record<string, string>;
  /** Query parameters to set on the URL. */
  query: Record<string, string>;
  /**
   * Every secret string this auth put on the wire. Callers redact these from
   * anything they persist — a target that echoes request headers back would
   * otherwise write the credential into `NodeExecution.output`.
   */
  secretValues: string[];
  /**
   * Header names carrying credential material. `safeFetch` strips these on a
   * cross-origin redirect hop; a custom `X-API-Key` is just as sensitive as
   * `Authorization` and is not in the spec's default list.
   */
  credentialHeaderNames: string[];
}

const EMPTY_AUTH: AppliedHttpAuth = {
  headers: {},
  query: {},
  secretValues: [],
  credentialHeaderNames: [],
};

/** First non-empty value among `keys`, or undefined. */
function pick(
  secret: CredentialSecret,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = secret[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

function missing(mode: HttpAuthMode, keys: readonly string[]): never {
  throw new NonRetriableError(
    `HTTP auth: the selected credential has no value for "${mode}" auth ` +
      `(looked for ${keys.map((k) => `"${k}"`).join(", ")}). ` +
      "Pick a credential of a matching type, or change the auth mode.",
  );
}

/**
 * Candidate field names per mode, in preference order. Credential types are
 * open-ended (any provider may register one), so a mode reads whichever of the
 * conventional key names the chosen type happens to use rather than requiring
 * a 1:1 mapping between credential kind and auth mode.
 */
const BEARER_KEYS = ["token", "accessToken", "apiKey", "value"] as const;
const OAUTH_KEYS = ["accessToken"] as const;
const HEADER_VALUE_KEYS = ["value", "apiKey", "token", "accessToken"] as const;
const QUERY_VALUE_KEYS = ["apiKey", "value", "token", "accessToken"] as const;

/**
 * Build the headers and query parameters that authenticate one request.
 *
 * `secret` is undefined when no credential is bound; every mode but `none`
 * then fails loudly rather than sending an unauthenticated request that the
 * provider answers with a confusing 401.
 */
export function buildHttpAuth(
  mode: HttpAuthMode | undefined,
  secret: CredentialSecret | undefined,
  options: HttpAuthOptions = {},
): AppliedHttpAuth {
  const resolved = mode ?? "none";
  if (resolved === "none") {
    return EMPTY_AUTH;
  }

  if (!secret) {
    throw new NonRetriableError(
      `HTTP auth: auth mode is "${resolved}" but no credential is bound to this node.`,
    );
  }

  switch (resolved) {
    case "bearer": {
      const token = pick(secret, BEARER_KEYS) ?? missing(resolved, BEARER_KEYS);
      return {
        headers: { Authorization: `Bearer ${token}` },
        query: {},
        secretValues: [token],
        credentialHeaderNames: ["authorization"],
      };
    }

    case "oauth2": {
      // The AF-M3 refresh cron (`refresh-oauth-tokens`) rewrites `accessToken`
      // in place every 15 minutes for credentials inside their expiry window,
      // so reading the field here is what "honours the refresh path" means:
      // the executor never refreshes inline and never caches a token across
      // runs. A credential whose refresh failed carries `refreshError` and
      // surfaces as a 401 from the provider, which is the honest outcome.
      const token = pick(secret, OAUTH_KEYS) ?? missing(resolved, OAUTH_KEYS);
      return {
        headers: { Authorization: `Bearer ${token}` },
        query: {},
        secretValues: [token],
        credentialHeaderNames: ["authorization"],
      };
    }

    case "basic": {
      const username = secret.username ?? secret.user ?? secret.email;
      const password = pick(secret, ["password", "apiKey", "token"]);
      if (!username || !password) {
        missing(resolved, ["username", "password"]);
      }
      const encoded = Buffer.from(`${username}:${password}`).toString("base64");
      return {
        headers: { Authorization: `Basic ${encoded}` },
        query: {},
        // Both the encoded form and the raw password are secret material: the
        // encoded blob is trivially reversible, and a target that echoes the
        // decoded credential back would otherwise slip past redaction.
        secretValues: [encoded, password],
        credentialHeaderNames: ["authorization"],
      };
    }

    case "header": {
      const name = options.headerName?.trim() || secret.name;
      if (!name) {
        throw new NonRetriableError(
          'HTTP auth: "header" auth needs a header name — set one on the node, ' +
            'or use a credential type with a "name" field.',
        );
      }
      const value =
        pick(secret, HEADER_VALUE_KEYS) ?? missing(resolved, HEADER_VALUE_KEYS);
      return {
        headers: { [name]: value },
        query: {},
        secretValues: [value],
        credentialHeaderNames: [name.toLowerCase()],
      };
    }

    case "queryParam": {
      const name =
        options.queryParamName?.trim() || secret.name || secret.param || "key";
      const value =
        pick(secret, QUERY_VALUE_KEYS) ?? missing(resolved, QUERY_VALUE_KEYS);
      return {
        headers: {},
        query: { [name]: value },
        secretValues: [value],
        credentialHeaderNames: [],
      };
    }
  }
}
