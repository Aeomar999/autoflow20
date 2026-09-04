import "server-only";
import { NonRetriableError, RetryAfterError } from "inngest";
import type { CredentialSecret } from "@/features/credentials/server/vault";

/**
 * The one Stripe client for workflow actions (AF-M10-20).
 *
 * Separate from the webhook route's `Stripe` SDK instance, which authenticates
 * with a deployment-level signing secret and only verifies inbound events.
 * These nodes act **as the tenant**, with the tenant's own secret key from
 * their credential — so one workspace cannot create customers on another's
 * account.
 *
 * **Every mutating call carries an `Idempotency-Key`.** Stripe honours it for
 * 24 hours: a retry with the same key returns the original object instead of
 * creating a second customer or a second payment link. This is the difference
 * between a retried step being safe and a workflow quietly duplicating
 * someone's billing records.
 */

const STRIPE_API = "https://api.stripe.com/v1";
const REQUEST_TIMEOUT_MS = 30_000;

export interface StripeCustomer {
  id: string;
  email?: string | null;
  name?: string | null;
  phone?: string | null;
  created?: number;
  metadata?: Record<string, string>;
}

export interface StripeError {
  error?: {
    type?: string;
    code?: string;
    message?: string;
    param?: string;
  };
}

function classify(
  status: number,
  headers: Headers,
  body: StripeError,
  where: string,
) {
  const code = body.error?.code ?? "";
  const type = body.error?.type ?? "";
  const message = body.error?.message ?? "";

  if (status === 401) {
    return new NonRetriableError(
      `${where}: Stripe rejected the secret key. Reconnect the Stripe credential — retrying will not fix a revoked or rolled key.`,
    );
  }

  if (status === 402 || type === "card_error") {
    // A declined card is the customer's bank saying no. Retrying is not going
    // to change their mind, and each attempt is visible on their statement.
    return new NonRetriableError(
      `${where}: the payment was declined (${code || "card_error"})${message ? `: ${message}` : ""}. This is the issuer's decision, not a transient fault.`,
    );
  }

  if (status === 429) {
    const retryAfter = Number(headers.get("retry-after") ?? "5");
    return new RetryAfterError(
      `${where}: Stripe rate limit hit.`,
      Number.isFinite(retryAfter) ? retryAfter : 5,
    );
  }

  if (status === 400 || status === 404) {
    return new NonRetriableError(
      `${where}: Stripe refused the request (${code || status})${message ? `: ${message}` : ""}.`,
    );
  }

  if (status >= 500) {
    // Safe to retry precisely because the idempotency key travels with it.
    return new RetryAfterError(
      `${where}: Stripe is unavailable (${status}).`,
      10,
    );
  }

  return new NonRetriableError(
    `${where}: Stripe request failed (${status})${message ? `: ${message}` : ""}.`,
  );
}

/**
 * Flatten an object into Stripe's bracket form.
 *
 * Stripe takes `application/x-www-form-urlencoded`, not JSON, and nests with
 * `metadata[order_id]` / `line_items[0][price]`. Sending JSON gets a 400 whose
 * message does not mention the encoding.
 */
export function toFormBody(
  value: Record<string, unknown>,
  prefix = "",
): URLSearchParams {
  const params = new URLSearchParams();

  const append = (key: string, raw: unknown): void => {
    if (raw === undefined || raw === null) return;

    if (Array.isArray(raw)) {
      raw.forEach((entry, index) => {
        append(`${key}[${index}]`, entry);
      });
      return;
    }
    if (typeof raw === "object") {
      for (const [childKey, childValue] of Object.entries(
        raw as Record<string, unknown>,
      )) {
        append(`${key}[${childKey}]`, childValue);
      }
      return;
    }
    params.append(key, String(raw));
  };

  for (const [key, raw] of Object.entries(value)) {
    append(prefix ? `${prefix}[${key}]` : key, raw);
  }

  return params;
}

export interface StripeRequest {
  path: string;
  method?: "GET" | "POST";
  body?: Record<string, unknown>;
  query?: Record<string, unknown>;
  /**
   * Required on every POST. Omitting it is what makes a retried step create a
   * duplicate, so the type makes it a decision rather than an oversight.
   */
  idempotencyKey?: string;
  where: string;
}

export async function stripeFetch<T>(
  secret: CredentialSecret | undefined,
  request: StripeRequest,
): Promise<T> {
  const apiKey = secret?.apiKey;
  if (!apiKey) {
    throw new NonRetriableError(
      `${request.where}: no Stripe credential is bound to this node. Connect a Stripe credential.`,
    );
  }

  const method = request.method ?? "GET";
  const url = new URL(`${STRIPE_API}${request.path}`);
  if (request.query) {
    for (const [key, value] of toFormBody(request.query).entries()) {
      url.searchParams.append(key, value);
    }
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    Accept: "application/json",
  };

  if (method === "POST") {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    if (request.idempotencyKey) {
      headers["Idempotency-Key"] = request.idempotencyKey;
    }
  }

  const response = await fetch(url, {
    method,
    headers,
    body:
      method === "POST" ? toFormBody(request.body ?? {}).toString() : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const payload = (await response.json().catch(() => ({}))) as T & StripeError;

  if (!response.ok) {
    throw classify(response.status, response.headers, payload, request.where);
  }

  return payload;
}

/**
 * Find a customer by email, or create one.
 *
 * Stripe allows several customers with the same email — it treats email as a
 * label, not a key — so "find or create" has to be done explicitly, and doing
 * it wrong is how a billing account accumulates four copies of the same
 * person. The search runs first; the create carries the idempotency key so a
 * retry of the whole step cannot slip a second customer past the search.
 */
export async function findOrCreateCustomer(args: {
  secret: CredentialSecret | undefined;
  email: string;
  name?: string;
  phone?: string;
  metadata?: Record<string, string>;
  idempotencyKey: string;
  where: string;
}): Promise<{ customer: StripeCustomer; created: boolean }> {
  const existing = await stripeFetch<{ data?: StripeCustomer[] }>(args.secret, {
    path: "/customers",
    query: { email: args.email, limit: 1 },
    where: args.where,
  });

  const found = existing.data?.[0];
  if (found?.id) {
    return { customer: found, created: false };
  }

  const customer = await stripeFetch<StripeCustomer>(args.secret, {
    path: "/customers",
    method: "POST",
    body: {
      email: args.email,
      ...(args.name ? { name: args.name } : {}),
      ...(args.phone ? { phone: args.phone } : {}),
      ...(args.metadata ? { metadata: args.metadata } : {}),
    },
    idempotencyKey: args.idempotencyKey,
    where: args.where,
  });

  return { customer, created: true };
}
