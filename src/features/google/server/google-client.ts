import "server-only";
import { NonRetriableError, RetryAfterError } from "inngest";
import type { CredentialSecret } from "@/features/credentials/server/vault";

/**
 * The one Google API client (AF-M10-15).
 *
 * 21 of the 35 reference automations touch Google — Sheets, Gmail, Drive,
 * Calendar. Every one of them needs the same three things done correctly, and
 * each is a thing that is easy to get subtly wrong once per node:
 *
 * 1. **Error classification.** Getting this backwards burns a user's quota.
 * 2. **Pagination**, bounded rather than "while (nextPageToken)".
 * 3. **Auth from the resolved credential**, never from node config.
 */

/** Pages one call will walk. A bound, not a guess — see `paginate`. */
export const MAX_PAGE_BUDGET = 20;

const REQUEST_TIMEOUT_MS = 30_000;

/** Response body read cap, mirroring the HTTP node's. */
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

export interface GoogleError {
  status: number;
  message: string;
  reason?: string;
}

/**
 * Turn a Google failure into the right kind of engine error.
 *
 * **This is the classification the task calls out, and the direction matters.**
 * A 429 or a 403 whose reason is a quota is *transient*: the right response is
 * to back off and try again. A 401, or a 403 whose reason is permissions, is
 * *permanent*: retrying it three times with exponential backoff spends the
 * user's remaining quota to receive the same refusal, and buries the real
 * message ("the token lacks the Drive scope") under retry noise.
 *
 * Google overloads 403 across both, which is why the `reason` field is read
 * rather than the status alone.
 */
export function classifyGoogleError(error: GoogleError): Error {
  const { status, message, reason } = error;

  const quotaReasons = new Set([
    "rateLimitExceeded",
    "userRateLimitExceeded",
    "quotaExceeded",
    "dailyLimitExceeded",
    "backendError",
    "internalError",
  ]);

  if (
    status === 429 ||
    (status === 403 && reason && quotaReasons.has(reason))
  ) {
    // Retriable. Google rarely sends Retry-After on these, so the engine's own
    // backoff (AF-M9-06) supplies the delay; the seconds here are a floor.
    return new RetryAfterError(
      `Google API rate limit or quota (${status}${reason ? ` ${reason}` : ""}): ${message}`,
      30,
    );
  }

  if (status >= 500) {
    return new RetryAfterError(
      `Google API is unavailable (${status}): ${message}`,
      10,
    );
  }

  if (status === 401) {
    return new NonRetriableError(
      `Google rejected the credential (401): ${message}. Reconnect the credential — retrying will not fix an expired or revoked token.`,
    );
  }

  if (status === 403) {
    return new NonRetriableError(
      `Google refused the request (403${reason ? ` ${reason}` : ""}): ${message}. This is usually a missing scope: reconnect the credential for the service this node uses.`,
    );
  }

  if (status === 404) {
    return new NonRetriableError(
      `Google could not find it (404): ${message}. Check the id — a spreadsheet, folder or message that does not exist will not appear on a retry.`,
    );
  }

  return new NonRetriableError(`Google API error ${status}: ${message}`);
}

/** Pull Google's structured error out of a response body. */
function parseGoogleError(status: number, body: string): GoogleError {
  try {
    const parsed = JSON.parse(body) as {
      error?: {
        message?: string;
        errors?: Array<{ reason?: string }>;
        status?: string;
      };
    };
    return {
      status,
      message: parsed.error?.message ?? body.slice(0, 300),
      reason: parsed.error?.errors?.[0]?.reason ?? parsed.error?.status,
    };
  } catch {
    return { status, message: body.slice(0, 300) };
  }
}

export interface GoogleRequest {
  /** Absolute Google API URL. */
  url: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** Raw bytes instead of JSON — Drive and Gmail uploads. */
  rawBody?: { data: Buffer | string; contentType: string };
  /** Node name, for error messages a user can act on. */
  where: string;
}

/**
 * One authenticated Google API call.
 *
 * The access token comes from the resolved credential map only. Node config is
 * persisted into `NodeExecution.input`, so a token read from there would be in
 * the trace before the request was made (AF-M3-04).
 */
export async function googleFetch<T>(
  secret: CredentialSecret | undefined,
  request: GoogleRequest,
): Promise<T> {
  const accessToken = secret?.accessToken;
  if (!accessToken) {
    throw new NonRetriableError(
      `${request.where}: no Google credential is bound to this node, or the connection has no access token. Connect the credential for this service.`,
    );
  }

  const url = new URL(request.url);
  for (const [key, value] of Object.entries(request.query ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
  };

  let body: BodyInit | undefined;
  if (request.rawBody) {
    headers["Content-Type"] = request.rawBody.contentType;
    body =
      typeof request.rawBody.data === "string"
        ? request.rawBody.data
        : new Uint8Array(request.rawBody.data);
  } else if (request.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(request.body);
  }

  const response = await fetch(url, {
    method: request.method ?? "GET",
    headers,
    body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const text = await readCapped(response);

  if (!response.ok) {
    const parsed = parseGoogleError(response.status, text);
    const classified = classifyGoogleError(parsed);
    classified.message = `${request.where}: ${classified.message}`;
    throw classified;
  }

  if (text.length === 0) {
    return undefined as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new NonRetriableError(
      `${request.where}: Google returned a response that is not JSON.`,
    );
  }
}

async function readCapped(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_RESPONSE_BYTES) {
      void reader.cancel();
      throw new NonRetriableError(
        `Google API response exceeded the ${MAX_RESPONSE_BYTES}-byte limit. Narrow the range, query or page size.`,
      );
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

/** Raw bytes from a Google endpoint (Drive downloads, Gmail attachments). */
export async function googleFetchBytes(
  secret: CredentialSecret | undefined,
  request: GoogleRequest & { maxBytes: number },
): Promise<Buffer> {
  const accessToken = secret?.accessToken;
  if (!accessToken) {
    throw new NonRetriableError(
      `${request.where}: no Google credential is bound to this node.`,
    );
  }

  const url = new URL(request.url);
  for (const [key, value] of Object.entries(request.query ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url, {
    method: request.method ?? "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    const parsed = parseGoogleError(response.status, await response.text());
    const classified = classifyGoogleError(parsed);
    classified.message = `${request.where}: ${classified.message}`;
    throw classified;
  }

  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);

  const chunks: Buffer[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > request.maxBytes) {
      void reader.cancel();
      throw new NonRetriableError(
        `${request.where}: the file exceeds the ${request.maxBytes}-byte limit for this node.`,
      );
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/**
 * Walk a paginated Google endpoint, bounded.
 *
 * `while (nextPageToken)` is the obvious loop and the wrong one: a Drive
 * folder with 200,000 files, or a Gmail query that matches everything, turns
 * one node into an unbounded sequence of requests that ends with a rate limit,
 * a timeout, or an out-of-memory. The budget makes the ceiling explicit and
 * reports when it was hit, so a truncated result is visible rather than
 * mistaken for the whole set.
 */
export async function paginate<TPage, TItem>(args: {
  fetchPage: (pageToken?: string) => Promise<TPage>;
  itemsOf: (page: TPage) => TItem[];
  nextTokenOf: (page: TPage) => string | undefined;
  /** Stop once this many items are collected. */
  limit: number;
  maxPages?: number;
}): Promise<{ items: TItem[]; truncated: boolean; pages: number }> {
  const maxPages = Math.min(args.maxPages ?? MAX_PAGE_BUDGET, MAX_PAGE_BUDGET);
  const items: TItem[] = [];
  let pageToken: string | undefined;
  let pages = 0;

  while (pages < maxPages) {
    const page = await args.fetchPage(pageToken);
    pages += 1;
    items.push(...args.itemsOf(page));

    if (items.length >= args.limit) {
      return {
        items: items.slice(0, args.limit),
        // More may exist beyond the limit; say so rather than implying the
        // caller has everything.
        truncated: items.length > args.limit || Boolean(args.nextTokenOf(page)),
        pages,
      };
    }

    pageToken = args.nextTokenOf(page);
    if (!pageToken) {
      return { items, truncated: false, pages };
    }
  }

  return { items: items.slice(0, args.limit), truncated: true, pages };
}
