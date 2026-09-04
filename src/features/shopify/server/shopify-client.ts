import "server-only";
import { NonRetriableError, RetryAfterError } from "inngest";
import type { CredentialSecret } from "@/features/credentials/server/vault";

/**
 * The Shopify Admin client (AF-M10-20).
 *
 * Two things shape it:
 *
 * 1. **The shop domain lives in the credential**, alongside the token. A shop
 *    domain in node config would let one workflow point a colleague's token at
 *    a different store — and the token is per-store, so the request would
 *    simply fail in a confusing way rather than doing anything useful.
 * 2. **Order creation has no idempotency header**, so duplicate protection
 *    uses what Shopify does offer: `source_name` + `source_identifier`. Shopify
 *    treats that pair as unique per shop, and a repeat POST returns the
 *    existing order instead of writing a second one. Without it, a retried
 *    step bills a customer twice.
 */

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Pinned. Shopify retires a version roughly a year after release, and an
 * unversioned call silently follows the newest one — so a response shape can
 * change under a running workflow without anything being deployed.
 */
export const SHOPIFY_API_VERSION = "2024-10";

/** Identifies orders this product created, for the dedupe pair above. */
export const SHOPIFY_SOURCE_NAME = "autoflow";

export interface ShopifyLineItem {
  title?: string;
  variant_id?: number | string;
  quantity: number;
  price?: string;
}

export interface ShopifyOrder {
  id: number;
  name?: string;
  order_number?: number;
  total_price?: string;
  currency?: string;
  financial_status?: string;
  order_status_url?: string;
  source_identifier?: string;
  customer?: { id?: number; email?: string };
}

interface ShopifyErrorBody {
  errors?: unknown;
}

function describeErrors(errors: unknown): string {
  if (!errors) return "";
  if (typeof errors === "string") return errors;
  if (Array.isArray(errors)) return errors.join("; ");
  if (typeof errors === "object") {
    // The common shape: { line_items: ["is invalid"], email: ["is invalid"] }
    return Object.entries(errors as Record<string, unknown>)
      .map(
        ([field, detail]) =>
          `${field}: ${Array.isArray(detail) ? detail.join(", ") : String(detail)}`,
      )
      .join("; ");
  }
  return "";
}

function classify(
  status: number,
  headers: Headers,
  body: ShopifyErrorBody,
  where: string,
) {
  const detail = describeErrors(body.errors);

  if (status === 401 || status === 403) {
    return new NonRetriableError(
      `${where}: Shopify rejected the access token${detail ? `: ${detail}` : ""}. Check the app is installed on this shop and has the write_orders scope.`,
    );
  }

  if (status === 404) {
    return new NonRetriableError(
      `${where}: Shopify returned 404. Check the shop domain on the credential — it is the myshopify.com host, not the storefront domain.`,
    );
  }

  if (status === 422) {
    return new NonRetriableError(
      `${where}: Shopify rejected the order as invalid${detail ? `: ${detail}` : ""}.`,
    );
  }

  if (status === 429) {
    // Shopify's leaky bucket. Retry-After is in seconds and it means it.
    const retryAfter = Number(headers.get("retry-after") ?? "2");
    return new RetryAfterError(
      `${where}: Shopify rate limit hit (leaky bucket full).`,
      Number.isFinite(retryAfter) ? Math.ceil(retryAfter) : 2,
    );
  }

  if (status >= 500) {
    return new RetryAfterError(
      `${where}: Shopify is unavailable (${status}).`,
      15,
    );
  }

  return new NonRetriableError(
    `${where}: Shopify refused the request (${status})${detail ? `: ${detail}` : ""}.`,
  );
}

export async function shopifyFetch<T>(
  secret: CredentialSecret | undefined,
  request: {
    path: string;
    method?: "GET" | "POST";
    body?: unknown;
    query?: Record<string, string | number | undefined>;
    where: string;
  },
): Promise<T> {
  const accessToken = secret?.accessToken;
  const shopDomain = secret?.shopDomain;

  if (!accessToken) {
    throw new NonRetriableError(
      `${request.where}: no Shopify credential is bound to this node. Connect a Shopify credential.`,
    );
  }
  if (!shopDomain) {
    throw new NonRetriableError(
      `${request.where}: the Shopify credential has no shop domain. Add it to the credential — a token alone does not say which store it belongs to.`,
    );
  }

  const host = shopDomain
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");

  const url = new URL(
    `https://${host}/admin/api/${SHOPIFY_API_VERSION}${request.path}`,
  );
  for (const [key, value] of Object.entries(request.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, {
    method: request.method ?? "GET",
    headers: {
      "X-Shopify-Access-Token": accessToken,
      Accept: "application/json",
      ...(request.body ? { "Content-Type": "application/json" } : {}),
    },
    body: request.body ? JSON.stringify(request.body) : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const payload = (await response.json().catch(() => ({}))) as T &
    ShopifyErrorBody;

  if (!response.ok) {
    throw classify(response.status, response.headers, payload, request.where);
  }

  return payload;
}

/**
 * Create an order, or return the one this step already created.
 *
 * The `source_identifier` is the idempotency mechanism Shopify actually
 * provides for orders: it is unique per `source_name` per shop. The lookup
 * runs first so a retry after a successful write but a lost response returns
 * the original order rather than billing the customer again.
 */
export async function createShopifyOrder(args: {
  secret: CredentialSecret | undefined;
  sourceIdentifier: string;
  order: Record<string, unknown>;
  where: string;
}): Promise<{ order: ShopifyOrder; created: boolean }> {
  const existing = await shopifyFetch<{ orders?: ShopifyOrder[] }>(
    args.secret,
    {
      path: "/orders.json",
      query: {
        source_identifier: args.sourceIdentifier,
        status: "any",
        limit: 1,
      },
      where: args.where,
    },
  );

  const found = existing.orders?.[0];
  if (found?.id) {
    return { order: found, created: false };
  }

  const created = await shopifyFetch<{ order?: ShopifyOrder }>(args.secret, {
    path: "/orders.json",
    method: "POST",
    body: {
      order: {
        ...args.order,
        source_name: SHOPIFY_SOURCE_NAME,
        source_identifier: args.sourceIdentifier,
      },
    },
    where: args.where,
  });

  if (!created.order?.id) {
    throw new NonRetriableError(
      `${args.where}: Shopify accepted the request but returned no order.`,
    );
  }

  return { order: created.order, created: true };
}
