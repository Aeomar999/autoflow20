import { AUTH_BUCKETS, type BucketConfig } from "./store";

export type AuthSurface = "sign-in" | "sign-up" | "reset";

/**
 * Resolve which auth surface a request pathname belongs to, or null when it is
 * not a rate-limited credential endpoint. Matches on path substrings so it is
 * resilient to the Better Auth base path (`/api/auth` by default).
 */
export function detectAuthSurface(pathname: string): AuthSurface | null {
  const p = pathname.toLowerCase();
  if (p.includes("/sign-in/") || p.includes("/sign-in")) return "sign-in";
  if (p.includes("/sign-up/") || p.includes("/sign-up")) return "sign-up";
  // Password reset request + the reset form + forget-password share one bucket.
  if (
    p.includes("/request-password-reset") ||
    p.includes("/reset-password") ||
    p.includes("/forget-password") ||
    p.includes("/forget-password/")
  ) {
    return "reset";
  }
  return null;
}

/** The bucket for an auth surface (security.md §8). */
export function authBucket(surface: AuthSurface): BucketConfig {
  switch (surface) {
    case "sign-in":
    case "sign-up":
      return AUTH_BUCKETS.SIGN_IN;
    case "reset":
      return AUTH_BUCKETS.RESET;
  }
}

/**
 * Derive the limiter key for an auth request. Login/signup are keyed per
 * (IP, email) to slow credential stuffing across accounts from one IP while
 * still throttling a single account hit from many IPs; password reset is keyed
 * per email (the reset email is itself the rate-limited deliverable, so IP is
 * irrelevant). The email is lower-cased and trimmed before keying.
 */
export function deriveAuthRateKey(
  surface: AuthSurface,
  ip: string,
  email: string | undefined,
): string {
  const identity = email?.trim().toLowerCase() ?? "";
  switch (surface) {
    case "reset":
      return `auth:reset:${identity}`;
    case "sign-in":
    case "sign-up":
      return `auth:${surface}:${ip}:${identity}`;
  }
}
