import "server-only";
import { NonRetriableError, RetryAfterError } from "inngest";
import type { CredentialSecret } from "@/features/credentials/server/vault";
import { serviceEndpoint } from "@/lib/server/service-endpoints";

/**
 * The MailerLite client (AF-M10-20).
 *
 * The useful thing to know: **`POST /subscribers` is an upsert.** MailerLite
 * matches on email and updates an existing subscriber rather than creating a
 * duplicate or erroring, which makes the create node naturally idempotent — no
 * key, no pre-check. That is worth stating out loud, because the same code
 * against most other list providers would be a duplicate-generator.
 *
 * The one that bites: creating a subscriber who **already unsubscribed** will
 * not resubscribe them, and MailerLite answers 200 either way. A workflow that
 * reports success has not necessarily added anyone to a mailing list, so the
 * node reports the returned status rather than assuming.
 */

const REQUEST_TIMEOUT_MS = 30_000;

export interface MailerLiteSubscriber {
  id?: string;
  email?: string;
  status?: string;
  source?: string;
  subscribed_at?: string | null;
  unsubscribed_at?: string | null;
  fields?: Record<string, unknown>;
  groups?: Array<{ id?: string; name?: string }>;
}

interface MailerLiteErrorBody {
  message?: string;
  errors?: Record<string, string[]>;
}

function classify(
  status: number,
  headers: Headers,
  body: MailerLiteErrorBody,
  where: string,
) {
  const detail = Object.entries(body.errors ?? {})
    .map(([field, messages]) => `${field}: ${messages.join(", ")}`)
    .join("; ");
  const message = detail || body.message || "";

  if (status === 401 || status === 403) {
    return new NonRetriableError(
      `${where}: MailerLite rejected the API key. Reconnect the credential — retrying will not fix a revoked token.`,
    );
  }

  if (status === 422) {
    return new NonRetriableError(
      `${where}: MailerLite rejected the request${message ? `: ${message}` : ""}.`,
    );
  }

  if (status === 429) {
    const retryAfter = Number(headers.get("retry-after") ?? "60");
    return new RetryAfterError(
      `${where}: MailerLite rate limit hit (120 requests/minute).`,
      Number.isFinite(retryAfter) ? retryAfter : 60,
    );
  }

  if (status >= 500) {
    return new RetryAfterError(
      `${where}: MailerLite is unavailable (${status}).`,
      15,
    );
  }

  return new NonRetriableError(
    `${where}: MailerLite refused the request (${status})${message ? `: ${message}` : ""}.`,
  );
}

export async function mailerliteFetch<T>(
  secret: CredentialSecret | undefined,
  request: {
    path: string;
    method?: "GET" | "POST";
    body?: unknown;
    where: string;
    /** 404 is a legitimate "not found" for a lookup, not a failure. */
    allowNotFound?: boolean;
  },
): Promise<T | null> {
  const apiKey = secret?.apiKey;
  if (!apiKey) {
    throw new NonRetriableError(
      `${request.where}: no MailerLite credential is bound to this node. Connect a MailerLite credential.`,
    );
  }

  const response = await fetch(
    `${serviceEndpoint("mailerlite")}${request.path}`,
    {
      method: request.method ?? "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        ...(request.body ? { "Content-Type": "application/json" } : {}),
      },
      body: request.body ? JSON.stringify(request.body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );

  if (response.status === 404 && request.allowNotFound) {
    return null;
  }

  const payload = (await response.json().catch(() => ({}))) as T &
    MailerLiteErrorBody;

  if (!response.ok) {
    throw classify(response.status, response.headers, payload, request.where);
  }

  return payload;
}

/** Look a subscriber up by email. Returns null when there is no such person. */
export async function findSubscriber(args: {
  secret: CredentialSecret | undefined;
  email: string;
  where: string;
}): Promise<MailerLiteSubscriber | null> {
  const result = await mailerliteFetch<{ data?: MailerLiteSubscriber }>(
    args.secret,
    {
      // The email is the lookup key in the path; MailerLite accepts it in
      // place of the numeric id.
      path: `/subscribers/${encodeURIComponent(args.email.trim().toLowerCase())}`,
      where: args.where,
      allowNotFound: true,
    },
  );

  return result?.data ?? null;
}

/**
 * Create or update a subscriber.
 *
 * Idempotent by the provider's own design — see the module comment. Group
 * assignment travels with the create, which is one request rather than two and
 * avoids a window where the subscriber exists in no group.
 */
export async function upsertSubscriber(args: {
  secret: CredentialSecret | undefined;
  email: string;
  fields?: Record<string, unknown>;
  groupIds?: string[];
  where: string;
}): Promise<MailerLiteSubscriber> {
  const result = await mailerliteFetch<{ data?: MailerLiteSubscriber }>(
    args.secret,
    {
      path: "/subscribers",
      method: "POST",
      body: {
        email: args.email.trim().toLowerCase(),
        ...(args.fields && Object.keys(args.fields).length > 0
          ? { fields: args.fields }
          : {}),
        ...(args.groupIds && args.groupIds.length > 0
          ? { groups: args.groupIds }
          : {}),
      },
      where: args.where,
    },
  );

  const subscriber = result?.data;
  if (!subscriber) {
    throw new NonRetriableError(
      `${args.where}: MailerLite accepted the request but returned no subscriber.`,
    );
  }
  return subscriber;
}
