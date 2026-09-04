import "server-only";
import { NonRetriableError, RetryAfterError } from "inngest";
import type { CredentialSecret } from "@/features/credentials/server/vault";

/**
 * The one Slack Web API client (AF-M10-17).
 *
 * **Slack does not use HTTP status codes to report failure.** Nearly every
 * error arrives as `HTTP 200` with `{"ok": false, "error": "channel_not_found"}`
 * in the body. Any client that checks `response.ok` — the obvious thing to
 * write, and what the webhook-only node effectively did — treats a failed post
 * as a success, stores a junk result, and lets the workflow carry on as if the
 * message had been delivered. That is the single most important thing this
 * module does.
 */

const SLACK_API = "https://slack.com/api";

const REQUEST_TIMEOUT_MS = 30_000;

/** Pages one listing will walk. A bound, not a guess. */
export const SLACK_MAX_PAGE_BUDGET = 10;

/**
 * Slack error codes that a retry could plausibly clear.
 *
 * Everything else is permanent: a channel that does not exist will not exist
 * on the third attempt, and retrying `missing_scope` three times only delays
 * the message that says which scope to add.
 */
const RETRIABLE_ERRORS = new Set([
  "ratelimited",
  "rate_limited",
  "internal_error",
  "service_unavailable",
  "fatal_error",
  "request_timeout",
]);

/** Codes that mean the connection itself is finished, not this request. */
const AUTH_ERRORS = new Set([
  "invalid_auth",
  "not_authed",
  "token_revoked",
  "token_expired",
  "account_inactive",
]);

/**
 * Sentences for the codes people actually hit, because Slack's own strings are
 * lowercase identifiers rather than advice.
 */
const ERROR_GUIDANCE: Record<string, string> = {
  channel_not_found:
    "No channel with that id or name. Use the channel ID (like C0123ABCD) rather than the display name, or list channels first.",
  not_in_channel:
    "The bot is not a member of that channel. Invite it, or add the chat:write.public scope so it can post to public channels it has not joined.",
  is_archived: "That channel is archived, so nothing can be posted to it.",
  name_taken:
    "A channel with that name already exists. Slack channel names are unique per workspace — list channels first and reuse the existing one.",
  invalid_name_specials:
    "Slack channel names allow only lowercase letters, digits, hyphens and underscores.",
  users_not_found:
    "No Slack user has that email address. The address must match the one on their Slack profile, which is often not their work address.",
  user_not_found: "No Slack user with that id.",
  cannot_dm_bot: "Slack does not allow opening a DM with another bot.",
  msg_too_long:
    "The message is over Slack's 40,000-character limit for a single message.",
  invalid_blocks:
    "Slack rejected the Block Kit payload. Blocks must be a JSON array of block objects.",
};

export interface SlackErrorInfo {
  code: string;
  /** Scopes Slack said were required, on a `missing_scope`. */
  needed?: string;
  provided?: string;
}

/**
 * Turn a Slack failure into the right kind of engine error.
 *
 * `declaredScopes` is what the *node* said it needs. Slack's `needed` field is
 * often a comma-separated list of alternatives and is absent entirely on some
 * codes, so the node's own declaration is the more useful thing to show.
 */
export function classifySlackError(
  error: SlackErrorInfo,
  context: { where: string; declaredScopes?: readonly string[] },
): Error {
  const { code, needed, provided } = error;
  const where = context.where;

  if (code === "missing_scope" || code === "not_allowed_token_type") {
    // The acceptance calls this out: a missing scope must read as a sentence
    // naming the scope, not as the token `missing_scope`.
    const wanted =
      needed ??
      (context.declaredScopes?.length
        ? context.declaredScopes.join(", ")
        : undefined);
    return new NonRetriableError(
      `${where}: the Slack connection is missing a required scope${
        wanted ? ` (needs ${wanted})` : ""
      }${provided ? `; it currently has ${provided}` : ""}. Reconnect the Slack credential to grant it — retrying will not add a scope.`,
    );
  }

  if (RETRIABLE_ERRORS.has(code)) {
    return new RetryAfterError(
      `${where}: Slack is rate limiting or temporarily unavailable (${code}).`,
      30,
    );
  }

  if (AUTH_ERRORS.has(code)) {
    return new NonRetriableError(
      `${where}: Slack rejected the credential (${code}). Reconnect the Slack credential — retrying will not fix a revoked or expired token.`,
    );
  }

  const guidance = ERROR_GUIDANCE[code];
  return new NonRetriableError(
    `${where}: Slack refused the request (${code})${guidance ? `. ${guidance}` : "."}`,
  );
}

export interface SlackRequest {
  /** Method name, e.g. `"chat.postMessage"`. */
  method: string;
  /** JSON body for a POST, or query parameters for a GET. */
  params?: Record<string, unknown>;
  httpMethod?: "GET" | "POST";
  /** Node name, for error messages a user can act on. */
  where: string;
  /** What the node declared it needs, for a readable `missing_scope`. */
  scopes?: readonly string[];
}

/** The envelope every Slack Web API method returns. */
interface SlackEnvelope {
  ok?: boolean;
  error?: string;
  needed?: string;
  provided?: string;
  warning?: string;
  response_metadata?: { next_cursor?: string; messages?: string[] };
}

/**
 * One authenticated Slack Web API call.
 *
 * Throws on `ok: false` — see the module comment. The bot token comes from the
 * resolved credential only, never from node config (AF-M3-04).
 */
export async function slackFetch<T>(
  secret: CredentialSecret | undefined,
  request: SlackRequest,
): Promise<T & SlackEnvelope> {
  const accessToken = secret?.accessToken;
  if (!accessToken) {
    throw new NonRetriableError(
      `${request.where}: no Slack credential is bound to this node, or the connection has no access token. Connect a Slack credential.`,
    );
  }

  const httpMethod = request.httpMethod ?? "POST";
  const url = new URL(`${SLACK_API}/${request.method}`);

  let body: string | undefined;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
  };

  if (httpMethod === "GET") {
    for (const [key, value] of Object.entries(request.params ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  } else {
    // charset is not optional here: Slack documents it explicitly and silently
    // misreads non-ASCII message text without it.
    headers["Content-Type"] = "application/json; charset=utf-8";
    body = JSON.stringify(request.params ?? {});
  }

  const response = await fetch(url, {
    method: httpMethod,
    headers,
    body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  // The one case where Slack does use a status code. `Retry-After` is in
  // seconds and Slack means it — its tiered limits are strict.
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get("retry-after") ?? "30");
    throw new RetryAfterError(
      `${request.where}: Slack rate limit hit on ${request.method}.`,
      Number.isFinite(retryAfter) ? retryAfter : 30,
    );
  }

  if (response.status >= 500) {
    throw new RetryAfterError(
      `${request.where}: Slack is unavailable (HTTP ${response.status}).`,
      15,
    );
  }

  const text = await response.text();
  let payload: (T & SlackEnvelope) | undefined;
  try {
    payload = JSON.parse(text) as T & SlackEnvelope;
  } catch {
    throw new NonRetriableError(
      `${request.where}: Slack returned a response that is not JSON (HTTP ${response.status}).`,
    );
  }

  // THE important line. Slack answers 200 with ok:false for almost every
  // failure, so a client that trusted the status code would store this as a
  // successful send.
  if (payload?.ok !== true) {
    throw classifySlackError(
      {
        code: payload?.error ?? "unknown_error",
        needed: payload?.needed,
        provided: payload?.provided,
      },
      { where: request.where, declaredScopes: request.scopes },
    );
  }

  return payload;
}

/**
 * Walk a cursor-paginated Slack listing, bounded.
 *
 * Slack pages with `response_metadata.next_cursor`, and a workspace can hold
 * tens of thousands of channels — `while (cursor)` is an unbounded sequence of
 * rate-limited requests. Truncation is reported rather than implied.
 */
export async function slackPaginate<TItem>(
  secret: CredentialSecret | undefined,
  args: {
    method: string;
    params?: Record<string, unknown>;
    /** Key in the envelope holding the rows, e.g. `"channels"`. */
    itemsKey: string;
    limit: number;
    where: string;
    scopes?: readonly string[];
  },
): Promise<{ items: TItem[]; truncated: boolean }> {
  const items: TItem[] = [];
  let cursor: string | undefined;
  let pages = 0;

  while (pages < SLACK_MAX_PAGE_BUDGET) {
    const page = await slackFetch<Record<string, unknown>>(secret, {
      method: args.method,
      httpMethod: "GET",
      params: {
        ...args.params,
        limit: Math.min(args.limit - items.length, 200),
        ...(cursor ? { cursor } : {}),
      },
      where: args.where,
      scopes: args.scopes,
    });

    const rows = page[args.itemsKey];
    if (Array.isArray(rows)) items.push(...(rows as TItem[]));
    pages += 1;

    if (items.length >= args.limit) {
      return { items: items.slice(0, args.limit), truncated: true };
    }

    cursor = page.response_metadata?.next_cursor || undefined;
    if (!cursor) return { items, truncated: false };
  }

  return { items: items.slice(0, args.limit), truncated: true };
}

/**
 * Slack's rules for a channel name, applied before the call.
 *
 * Slack lowercases and substitutes silently in some cases and rejects in
 * others, so a name derived from a template ("Acme Corp — Q3!") could either
 * create `acme-corp-q3` or fail, depending on characters. Normalising here
 * makes the result predictable and the failure legible.
 */
export function normalizeChannelName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 80);
}
