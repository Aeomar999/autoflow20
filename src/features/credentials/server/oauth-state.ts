import { createHmac } from "node:crypto";
import { ensureEnv } from "@/lib/env";

export interface OAuthState {
  userId: string;
  providerId: string;
  nonce: string;
}

/**
 * Signs the state payload using the CREDENTIAL_MASTER_KEY to prevent CSRF.
 */
export function signState(state: OAuthState): string {
  const payload = Buffer.from(JSON.stringify(state)).toString("base64url");
  const hmac = createHmac("sha256", ensureEnv().CREDENTIAL_MASTER_KEY)
    .update(payload)
    .digest("base64url");
  return `${payload}.${hmac}`;
}

/**
 * Verifies and parses the state payload.
 */
export function verifyState(stateToken: string): OAuthState {
  const [payload, signature] = stateToken.split(".");
  if (!payload || !signature) {
    throw new Error("Invalid state token format");
  }

  const expectedSignature = createHmac(
    "sha256",
    ensureEnv().CREDENTIAL_MASTER_KEY,
  )
    .update(payload)
    .digest("base64url");

  if (signature !== expectedSignature) {
    throw new Error("State signature mismatch - possible CSRF attack");
  }

  const json = Buffer.from(payload, "base64url").toString("utf-8");
  return JSON.parse(json) as OAuthState;
}
