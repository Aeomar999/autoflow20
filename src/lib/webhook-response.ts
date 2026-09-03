/**
 * Header policy for workflow-composed synchronous webhook responses
 * (AF-M9-10, G3).
 *
 * A `RESPOND_TO_WEBHOOK` node lets a workflow author choose the response
 * headers a caller receives. That is user-controlled input shaping an HTTP
 * response we emit, so it is filtered rather than trusted — and filtered in
 * one place, used by both the node (at compose time, so the author sees the
 * rejection while editing) and the route (at emit time, so a response that
 * somehow reached the DB unfiltered still cannot escape).
 *
 * The policy is an **allowlist**: a header passes only by matching a rule.
 * Two rules, in order:
 *   1. it is in `ALLOWED_RESPONSE_HEADERS` — the standard response headers a
 *      workflow has a legitimate reason to set; or
 *   2. it starts with `x-` — the conventional namespace for application
 *      headers, which cannot collide with a protocol header.
 *
 * Everything else is dropped. Notably absent, and deliberately:
 *   - `set-cookie`: a workflow that can set cookies on our origin can fixate
 *     or overwrite a session. Never allowed, and not `x-` prefixed, so rule 2
 *     cannot readmit it.
 *   - hop-by-hop headers (RFC 9110 §7.6.1): meaningful only to a single
 *     connection; forwarding them corrupts proxies and keep-alive.
 *   - `content-length` / `transfer-encoding`: owned by the runtime. A wrong
 *     length is a response-splitting primitive, not a formatting choice.
 *   - `content-type`: set through the node's own `contentType` field so there
 *     is exactly one source of truth. Two ways to set it is one way to make
 *     them disagree.
 */

/** Standard response headers a workflow may set. Lowercase; compared lowercase. */
export const ALLOWED_RESPONSE_HEADERS: ReadonlySet<string> = new Set([
  "cache-control",
  "content-disposition",
  "content-encoding",
  "content-language",
  "etag",
  "expires",
  "last-modified",
  "link",
  "location",
  "retry-after",
  "vary",
  // CORS: an endpoint meant for a browser caller is a real use case, and these
  // widen access to THIS response only — they cannot alter our own origin's
  // stored state the way `set-cookie` can.
  "access-control-allow-origin",
  "access-control-allow-methods",
  "access-control-allow-headers",
  "access-control-expose-headers",
  "access-control-max-age",
]);

/**
 * Hop-by-hop and runtime-owned headers. Listed explicitly so the reason a
 * header is refused can be reported precisely, and so a future edit to
 * `ALLOWED_RESPONSE_HEADERS` cannot readmit one by accident — `isHeaderAllowed`
 * checks this set first.
 */
export const FORBIDDEN_RESPONSE_HEADERS: ReadonlySet<string> = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "content-length",
  "content-type",
  "set-cookie",
]);

/** RFC 9110 token: the only characters legal in a header field name. */
const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/**
 * Header values may not carry CR or LF — that is response splitting, where a
 * value ending a header block lets the caller inject headers or a second
 * response body of their choosing. Also excludes NUL, which some proxies
 * truncate on.
 */
const HEADER_VALUE_FORBIDDEN = /[\r\n\0]/;

export function isHeaderAllowed(name: string): boolean {
  const lower = name.toLowerCase();
  if (!HEADER_NAME_PATTERN.test(name)) return false;
  if (FORBIDDEN_RESPONSE_HEADERS.has(lower)) return false;
  return ALLOWED_RESPONSE_HEADERS.has(lower) || lower.startsWith("x-");
}

export interface HeaderFilterResult {
  headers: Record<string, string>;
  /** Header names dropped, lowercased — surfaced so a drop is never silent. */
  rejected: string[];
}

/**
 * Apply the policy to a header map.
 *
 * Rejections are returned, not thrown: the node reports them to the author
 * (who can fix the config), while the route drops them and serves the rest —
 * a caller waiting on a response should get the response, not a 500 caused by
 * a header they never saw.
 */
export function filterResponseHeaders(
  headers: Record<string, string> | undefined,
): HeaderFilterResult {
  const out: Record<string, string> = {};
  const rejected: string[] = [];

  for (const [name, value] of Object.entries(headers ?? {})) {
    if (!isHeaderAllowed(name) || HEADER_VALUE_FORBIDDEN.test(value)) {
      rejected.push(name.toLowerCase());
      continue;
    }
    out[name] = value;
  }

  return { headers: out, rejected };
}

/**
 * HTTP status codes a workflow may return. The 1xx range is excluded on top
 * of the node's 100-599 schema bound: an informational status is an interim
 * response with no body, which the route cannot express and no caller of a
 * sync webhook wants.
 */
export function isValidResponseStatus(code: number): boolean {
  return Number.isInteger(code) && code >= 200 && code <= 599;
}
