import { createHmac, timingSafeEqual } from "node:crypto";
import { ensureEnv } from "@/lib/env";

export interface OAuthState {
  userId: string;
  providerId: string;
  nonce: string;
  /**
   * Organization the credential belongs to (AF-M10-03).
   *
   * Before this, the callback created credentials with a `userId` and no
   * `organizationId`. Every read path is org-scoped — `credentials.list`
   * filters on `organizationId`, and the engine resolves a node's credential
   * by `{ id, organizationId }` — so an OAuth credential was invisible in the
   * UI and unresolvable at run time. Connecting Google appeared to succeed and
   * then nothing could use it. The active org is captured at connect time and
   * carried through the redirect, because the callback arrives from the
   * provider with none of the app's own cookies guaranteed to still select it.
   *
   * Optional so a state token minted before this field existed still verifies
   * during a deploy overlap; the callback falls back to resolving the org.
   */
  organizationId?: string;
  /** PKCE verifier, for providers that require it (AF-M10-04). */
  codeVerifier?: string;
  /**
   * Connect-time parameters the provider declared (`OAuthProvider.connectParams`)
   * — Shopify's shop domain, Intuit's sandbox/production choice. They are not
   * echoed back by the provider, so they ride the signed state to the callback,
   * where they build the token URL and land in the credential's extras.
   */
  connectParams?: Record<string, string>;
  /** Issued-at, epoch seconds. States older than `STATE_TTL_SECONDS` are refused. */
  iat?: number;
}

/** How long an authorization may sit half-finished before its state expires. */
export const STATE_TTL_SECONDS = 15 * 60;

const sign = (payload: string): string =>
  createHmac("sha256", ensureEnv().CREDENTIAL_MASTER_KEY)
    .update(payload)
    .digest("base64url");

/**
 * Signs the state payload using the CREDENTIAL_MASTER_KEY to prevent CSRF.
 */
export function signState(state: OAuthState): string {
  const payload = Buffer.from(
    JSON.stringify({ iat: Math.floor(Date.now() / 1000), ...state }),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/**
 * Verifies and parses the state payload.
 *
 * The signature comparison is constant-time. A `!==` on two hex strings leaks
 * how many leading characters matched through its timing, which is enough to
 * forge a signature one character at a time given enough attempts — the same
 * class of defect the webhook verifiers avoid.
 */
export function verifyState(stateToken: string): OAuthState {
  const [payload, signature] = stateToken.split(".");
  if (!payload || !signature) {
    throw new Error("Invalid state token format");
  }

  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error("State signature mismatch - possible CSRF attack");
  }

  const json = Buffer.from(payload, "base64url").toString("utf-8");
  const state = JSON.parse(json) as OAuthState;

  if (
    typeof state.iat === "number" &&
    Date.now() / 1000 - state.iat > STATE_TTL_SECONDS
  ) {
    throw new Error("State token has expired - start the connection again");
  }

  return state;
}
