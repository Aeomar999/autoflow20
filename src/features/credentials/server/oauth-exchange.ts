import "server-only";
import type { OAuthProvider } from "./oauth-providers";

/**
 * Token-endpoint exchange, shared by the callback route and the refresh job
 * (AF-M10-04).
 *
 * These two used to hand-roll the same POST with slightly different rules, and
 * the differences were the bugs: only the callback knew about provider extras,
 * and only the refresh job knew what to do with a rotated refresh token. One
 * function, one set of provider quirks.
 */

export interface TokenResponse {
  accessToken: string;
  refreshToken?: string;
  /** Seconds until the access token expires; absent for non-expiring tokens. */
  expiresIn?: number;
  scope?: string;
  /** The raw body, for `captureExtras`. */
  raw: Record<string, unknown>;
}

export class OAuthExchangeError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "OAuthExchangeError";
  }
}

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

/**
 * POST to a provider's token endpoint and normalize the answer.
 *
 * `tokenAuth: "basic"` puts the client credentials in an Authorization header
 * instead of the body. Intuit and X both require it and answer the body form
 * with a bare `invalid_client`, which reads as "wrong secret" and sends people
 * to regenerate perfectly good credentials.
 */
export async function exchangeToken(args: {
  provider: OAuthProvider;
  tokenUrl?: string;
  body: Record<string, string>;
  timeoutMs?: number;
}): Promise<TokenResponse> {
  const { provider, body, timeoutMs = 15_000 } = args;
  const url = args.tokenUrl ?? provider.tokenUrl;

  const fields: Record<string, string> = { ...body };
  const headers: Record<string, string> = { Accept: "application/json" };

  if (provider.tokenAuth === "basic") {
    headers.Authorization = `Basic ${Buffer.from(
      `${provider.clientId}:${provider.clientSecret}`,
    ).toString("base64")}`;
  } else {
    fields.client_id = provider.clientId ?? "";
    fields.client_secret = provider.clientSecret ?? "";
  }

  const isJson = provider.tokenBodyFormat === "json";
  headers["Content-Type"] = isJson
    ? "application/json"
    : "application/x-www-form-urlencoded";

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: isJson
      ? JSON.stringify(fields)
      : new URLSearchParams(fields).toString(),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new OAuthExchangeError(
      `Provider rejected the token request: ${response.status} ${text.slice(0, 500)}`,
      response.status,
    );
  }

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // Slack and a few others answer form-encoded when Accept is ignored.
    raw = Object.fromEntries(new URLSearchParams(text));
  }

  const accessToken = asString(raw.access_token);
  if (!accessToken) {
    throw new OAuthExchangeError(
      "Provider did not return an access token in its response.",
    );
  }

  const expiresInRaw = raw.expires_in;
  const expiresIn =
    typeof expiresInRaw === "number"
      ? expiresInRaw
      : typeof expiresInRaw === "string"
        ? Number.parseInt(expiresInRaw, 10)
        : undefined;

  return {
    accessToken,
    refreshToken: asString(raw.refresh_token),
    expiresIn:
      typeof expiresIn === "number" && Number.isFinite(expiresIn)
        ? expiresIn
        : undefined,
    scope: asString(raw.scope),
    raw,
  };
}

/**
 * Build the secret object persisted for an OAuth credential.
 *
 * `previous` carries fields an exchange does not return — most importantly a
 * refresh token the provider omitted because it did not rotate one. Dropping
 * it would end the connection at the next expiry.
 */
export function buildOAuthSecret(args: {
  provider: OAuthProvider;
  token: TokenResponse;
  query: URLSearchParams;
  previous?: Record<string, string>;
}): Record<string, string> {
  const { provider, token, query, previous } = args;

  const secret: Record<string, string> = {
    ...previous,
    accessToken: token.accessToken,
  };

  if (token.refreshToken) {
    secret.refreshToken = token.refreshToken;
  }
  if (token.scope) {
    secret.scopes = token.scope;
  }

  // Provider extras (Intuit's realmId, Shopify's shop). Captured last so a
  // fresh value wins over whatever the previous secret held.
  Object.assign(
    secret,
    provider.captureExtras?.({ query, token: token.raw }) ?? {},
  );

  return secret;
}
