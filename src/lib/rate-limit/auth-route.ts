import "server-only";
import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import {
  authBucket,
  deriveAuthRateKey,
  detectAuthSurface,
  memoryRateLimiter,
} from "@/lib/rate-limit";

/**
 * Client IP for rate-limit keys. Behind Vercel/reverse proxies the real IP is
 * in `x-forwarded-for` (first hop) or Vercel's `cf-connecting-ip`; fall back to
 * a stable sentinel when absent rather than keying everything as the same IP.
 */
export function clientIp(
  headers: Headers,
  fallback: string = "unknown-ip",
): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return (
    headers.get("cf-connecting-ip") ??
    headers.get("x-real-ip") ??
    headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ??
    fallback
  );
}

/**
 * Rate-limit a credential auth request before it reaches Better Auth.
 *
 * Returns a 429 response when the surface (sign-in/sign-up/password-reset)
 * bucket is exhausted, or `null` to pass the request through. The caller passes
 * the ORIGINAL Request to the downstream handler; this helper reads only a clone
 * so the body is never consumed.
 */
export async function tryRateLimited(
  request: Request,
  pathname: string,
): Promise<NextResponse | null> {
  const surface = detectAuthSurface(pathname);
  if (!surface) return null;

  let email: string | undefined;
  try {
    const json = await request.clone().json();
    if (json && typeof json === "object" && "email" in json) {
      const value = (json as { email?: unknown }).email;
      if (typeof value === "string") email = value;
    }
  } catch {
    // Malformed/non-JSON body: still rate-limit on IP alone.
  }

  const key = deriveAuthRateKey(surface, clientIp(request.headers), email);

  const decision = memoryRateLimiter.consume(key, authBucket(surface));
  if (decision.allowed) return null;

  logger.warn("auth rate limit exceeded", {
    surface,
    ip: clientIp(request.headers),
  });
  return NextResponse.json(
    { error: "Too many requests" },
    {
      status: 429,
      headers: {
        "Retry-After": String(decision.retryAfterSeconds),
      },
    },
  );
}
