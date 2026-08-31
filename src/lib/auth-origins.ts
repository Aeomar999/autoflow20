/**
 * Trusted origins for Better Auth (AF-M0-08 follow-up).
 *
 * Better Auth rejects any request whose `Origin` header does not match its
 * `baseURL` — the "Invalid origin" error on sign-up. `BETTER_AUTH_URL` alone
 * cannot cover every origin this app is legitimately reached from:
 *
 *   - Vercel preview deployments get a unique hostname per branch, so no
 *     fixed value can ever match them. `VERCEL_URL` is injected per
 *     deployment, which is the only way to allow them without hardcoding.
 *   - The ngrok tunnel used for webhook testing is a different host again.
 *   - `127.0.0.1` and `localhost` are different origins to the check, even
 *     though they resolve to the same machine.
 *
 * Pure and env-injected so the list is unit-testable without a server.
 */

export interface OriginEnv {
  BETTER_AUTH_URL?: string;
  NEXT_PUBLIC_APP_URL?: string;
  NGROK_URL?: string;
  VERCEL_URL?: string;
}

/** Adds https:// to a bare host. `NGROK_URL` and `VERCEL_URL` carry no scheme. */
function toOrigin(value: string): string | null {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (trimmed.length === 0) return null;
  const withScheme = /^https?:\/\//.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    return new URL(withScheme).origin;
  } catch {
    // A malformed value must not take down auth for every other origin, and
    // silently trusting an unparseable string would be worse than dropping it.
    return null;
  }
}

/**
 * Every origin Better Auth should accept, deduplicated and order-stable.
 *
 * Localhost is always included: dropping it would break local development the
 * moment `BETTER_AUTH_URL` is pointed at a deployed URL.
 */
export function resolveTrustedOrigins(env: OriginEnv): string[] {
  const candidates = [
    env.BETTER_AUTH_URL,
    env.NEXT_PUBLIC_APP_URL,
    env.NGROK_URL,
    env.VERCEL_URL,
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ];

  const origins: string[] = [];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const origin = toOrigin(candidate);
    if (origin && !origins.includes(origin)) {
      origins.push(origin);
    }
  }
  return origins;
}
