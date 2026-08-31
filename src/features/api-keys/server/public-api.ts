import "server-only";
import { type NextRequest, NextResponse } from "next/server";
import {
  type ApiKeyScope,
  hashApiKey,
  hasScope,
} from "@/features/api-keys/lib/key";
import {
  type RateLimitDecision,
  resolveApiBucketLimits,
  TokenBucketLimiter,
} from "@/features/api-keys/lib/rate-limit";
import prisma from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * Public REST API (v1) authentication + response helpers (AF-M8-01).
 *
 * Server-only. The only public surface (tRPC is internal by design -
 * `docs/architecture/api_contract.md` §1), so this is deliberately NOT reachable
 * from the web client. Every request is authenticated with a scoped, hashed
 * API key (`docs/decisions/0012-public-api-and-api-keys.md`).
 */

export class PublicApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
    /** Seconds to wait before retrying; set for 429 responses. */
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "PublicApiError";
  }
}

/** The authenticated principal for a request: the org the key belongs to,
 * never a user session. All queries scope on `organizationId` from here. */
export interface ApiKeyPrincipal {
  apiKeyId: string;
  organizationId: string;
  plan: string;
  rateLimit: RateLimitDecision;
}

// Per-instance limiter. See AF-M8-02 for the shared-store follow-up.
const limiter = new TokenBucketLimiter();

/**
 * Resolve the `Authorization: Bearer <af_...>` token to an org principal.
 *
 * Authz model (ADR-0012 §3): the key IS the tenant boundary. A valid, live key
 * with the required scope is admitted; everything else is rejected before any
 * data is touched. A revoked/expired/unknown key is `401 UNAUTHENTICATED` (no
 * resource-existence leak), a valid key missing the scope is `403 FORBIDDEN`.
 */
export async function authenticateApiRequest(
  req: NextRequest,
  requiredScope: ApiKeyScope,
): Promise<ApiKeyPrincipal> {
  const auth = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
  if (!match) {
    throw new PublicApiError(
      401,
      "UNAUTHENTICATED",
      "Missing or malformed Authorization header. Use 'Authorization: Bearer af_...'.",
    );
  }

  const hash = hashApiKey(match[1].trim());

  const key = await prisma.apiKey.findUnique({
    where: { hash },
    select: {
      id: true,
      scopes: true,
      revokedAt: true,
      expiresAt: true,
      organizationId: true,
      organization: { select: { plan: true } },
    },
  });

  const now = new Date();
  if (
    !key ||
    key.revokedAt !== null ||
    (key.expiresAt !== null && key.expiresAt <= now)
  ) {
    throw new PublicApiError(401, "UNAUTHENTICATED", "Invalid API key");
  }

  if (!hasScope(key.scopes, requiredScope)) {
    throw new PublicApiError(
      403,
      "FORBIDDEN",
      `Missing required scope: ${requiredScope}`,
    );
  }

  const rateLimit = limiter.consume(
    key.id,
    resolveApiBucketLimits(key.organization.plan),
  );
  if (!rateLimit.allowed) {
    throw new PublicApiError(
      429,
      "TOO_MANY_REQUESTS",
      "Rate limit exceeded",
      undefined,
      rateLimit.retryAfterSeconds,
    );
  }

  // Best-effort last-used touch. Failures are logged, never surfaced - an
  // observability write must not fail a request.
  void prisma.apiKey
    .update({ where: { id: key.id }, data: { lastUsedAt: now } })
    .catch((e) =>
      logger.warn("public API failed to touch lastUsedAt", {
        apiKeyId: key.id,
        error: e,
      }),
    );

  return {
    apiKeyId: key.id,
    organizationId: key.organizationId,
    plan: key.organization.plan,
    rateLimit,
  };
}

/** Error envelope per `api_contract.md` §5: `{ error: { code, message, details? } }`. */
export function publicApiErrorResponse(err: PublicApiError): NextResponse {
  const body: Record<string, unknown> = {
    error: { code: err.code, message: err.message },
  };
  if (err.details !== undefined) {
    (body.error as { details?: unknown }).details = err.details;
  }
  const respHeaders: Record<string, string> = {};
  if (err.status === 429 && err.retryAfterSeconds !== undefined) {
    respHeaders["Retry-After"] = String(err.retryAfterSeconds);
  }
  return NextResponse.json(body, { status: err.status, headers: respHeaders });
}

const RATE_HEADER_LIMIT = "X-RateLimit-Limit";
const RATE_HEADER_REMAINING = "X-RateLimit-Remaining";
const RATE_HEADER_RESET = "X-RateLimit-Reset";
const RATE_WINDOW_SECONDS = 60;

function withRateHeaders(
  response: NextResponse,
  decision: RateLimitDecision | undefined,
): NextResponse {
  if (!decision) return response;
  response.headers.set(RATE_HEADER_LIMIT, String(decision.limit));
  response.headers.set(RATE_HEADER_REMAINING, String(decision.remaining));
  response.headers.set(RATE_HEADER_RESET, String(RATE_WINDOW_SECONDS));
  return response;
}

/**
 * Wrap a public-API handler: authenticate, run, serialize JSON, and attach the
 * error envelope / rate-limit headers / generic 500 consistently.
 *
 * `run` must NOT return sensitive material and should scope every query to
 * `principal.organizationId`. A thrown `PublicApiError` maps to its status;
 * anything else becomes a scrubbed 500 (full detail only in the logs).
 */
export async function handlePublicApi(
  req: NextRequest,
  requiredScope: ApiKeyScope,
  run: (principal: ApiKeyPrincipal) => Promise<unknown>,
): Promise<NextResponse> {
  let principal: ApiKeyPrincipal | undefined;
  try {
    principal = await authenticateApiRequest(req, requiredScope);
    return withRateHeaders(
      NextResponse.json(await run(principal)),
      principal.rateLimit,
    );
  } catch (err) {
    if (err instanceof PublicApiError) {
      return withRateHeaders(publicApiErrorResponse(err), principal?.rateLimit);
    }
    logger.error("public API unhandled error", { error: err });
    const generic = new PublicApiError(
      500,
      "INTERNAL_SERVER_ERROR",
      "Internal server error",
    );
    return withRateHeaders(
      publicApiErrorResponse(generic),
      principal?.rateLimit,
    );
  }
}
