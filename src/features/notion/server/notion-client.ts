import "server-only";
import { NonRetriableError, RetryAfterError } from "inngest";
import type { CredentialSecret } from "@/features/credentials/server/vault";

/**
 * The one Notion client (AF-M10-18).
 *
 * Two things shape everything here:
 *
 * 1. **`Notion-Version` is required on every request.** Omitting it is a hard
 *    400, and pinning it is what stops a future Notion default from changing
 *    response shapes under a running workflow.
 * 2. **Notion's permission model is per-object, not per-scope.** A connection
 *    can only see pages and databases a person explicitly shared with the
 *    integration, and an unshared database returns the same
 *    `object_not_found` as one that does not exist. "You have Notion
 *    connected" therefore says nothing about whether a given database is
 *    reachable, which is why that error names sharing as the first thing to
 *    check.
 */

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";
const REQUEST_TIMEOUT_MS = 30_000;

/** Pages one listing will walk. A bound, not a guess. */
export const NOTION_MAX_PAGE_BUDGET = 10;

export interface NotionRequest {
  path: string;
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  /** Node name, for errors a user can act on. */
  where: string;
}

interface NotionErrorBody {
  code?: string;
  message?: string;
}

function classify(
  status: number,
  headers: Headers,
  body: NotionErrorBody | undefined,
  where: string,
): Error {
  const code = body?.code ?? "";
  const message = body?.message ?? "";

  if (status === 401 || code === "unauthorized") {
    return new NonRetriableError(
      `${where}: Notion rejected the credential. Reconnect the Notion connection — retrying will not fix a revoked token.`,
    );
  }

  if (code === "object_not_found" || status === 404) {
    // The most common real cause by a wide margin, and Notion's own message
    // does not mention it.
    return new NonRetriableError(
      `${where}: Notion cannot see that page or database. Notion returns the same answer for "does not exist" and "not shared with this integration", and the second is far more common — open the page in Notion, use its ••• menu, and connect this integration to it.`,
    );
  }

  if (code === "restricted_resource") {
    return new NonRetriableError(
      `${where}: the Notion integration is not allowed to perform that action on this object. Check the capabilities set on the integration.`,
    );
  }

  if (code === "validation_error") {
    return new NonRetriableError(
      `${where}: Notion rejected the request${message ? `: ${message}` : ""}. For a page create, every property name and type must match the database's schema exactly — Notion is case-sensitive about property names.`,
    );
  }

  if (status === 429 || code === "rate_limited") {
    const retryAfter = Number(headers.get("retry-after") ?? "10");
    return new RetryAfterError(
      `${where}: Notion rate limit hit.`,
      Number.isFinite(retryAfter) ? retryAfter : 10,
    );
  }

  if (status >= 500) {
    return new RetryAfterError(
      `${where}: Notion is unavailable (${status}).`,
      15,
    );
  }

  return new NonRetriableError(
    `${where}: Notion refused the request (${status}${code ? ` ${code}` : ""})${message ? `: ${message}` : ""}.`,
  );
}

/** One authenticated Notion API call. */
export async function notionFetch<T>(
  secret: CredentialSecret | undefined,
  request: NotionRequest,
): Promise<T> {
  const accessToken = secret?.accessToken;
  if (!accessToken) {
    throw new NonRetriableError(
      `${request.where}: no Notion credential is bound to this node. Connect a Notion credential.`,
    );
  }

  const url = new URL(`${NOTION_API}${request.path}`);
  for (const [key, value] of Object.entries(request.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, {
    method: request.method ?? "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      // Required. Not a nicety — a request without it is a 400.
      "Notion-Version": NOTION_VERSION,
      Accept: "application/json",
      ...(request.body ? { "Content-Type": "application/json" } : {}),
    },
    body: request.body ? JSON.stringify(request.body) : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    let parsed: NotionErrorBody | undefined;
    try {
      parsed = (await response.json()) as NotionErrorBody;
    } catch {
      parsed = undefined;
    }
    throw classify(response.status, response.headers, parsed, request.where);
  }

  return (await response.json()) as T;
}

/**
 * Normalise a Notion id.
 *
 * People paste page URLs, and a Notion URL ends in a 32-character id with no
 * dashes while the API returns and expects the dashed UUID form. The API does
 * accept the dashless form, but a URL also carries a title slug and possibly a
 * `?v=` view id in front of it, and passing that whole string through gives an
 * `object_not_found` that reads like a permission problem.
 */
export function normalizeNotionId(raw: string, where: string): string {
  // Drop the query string BEFORE looking for an id. A database URL carries the
  // view id in `?v=`, which sits after the object id — so scanning the whole
  // string and taking the last match returns the view, and the view id is not
  // a database the API will find.
  const trimmed = raw.trim().split(/[?#]/)[0];

  // The object id is the last 32 hex characters of the path: a page URL is
  // `…/Title-Slug-<id>`, and a bare id is just itself.
  const matches = trimmed.replace(/-/g, "").match(/[0-9a-fA-F]{32}/g);
  const id = matches?.[matches.length - 1];

  if (!id) {
    throw new NonRetriableError(
      `${where}: "${raw}" does not contain a Notion id. Paste the page or database URL, or its 32-character id.`,
    );
  }

  return [
    id.slice(0, 8),
    id.slice(8, 12),
    id.slice(12, 16),
    id.slice(16, 20),
    id.slice(20),
  ]
    .join("-")
    .toLowerCase();
}

// ---------------------------------------------------------------------------
// Property values
// ---------------------------------------------------------------------------

export type NotionPropertySchema = { type?: string; name?: string };

/**
 * Build a Notion property value of the right shape for its declared type.
 *
 * Notion's property values are a tagged union, and the tag has to match the
 * column's type exactly: a `select` column will not take `{rich_text: [...]}`,
 * and the error says "body failed validation" without naming the column. This
 * takes the plain string a workflow produced and wraps it the way the schema
 * says to, so authoring a page does not require knowing the union.
 *
 * Returns undefined for a type this cannot express, so the caller can skip the
 * property rather than send something Notion will reject.
 */
export function buildNotionProperty(
  type: string | undefined,
  value: string,
): unknown | undefined {
  const text = value.trim();
  if (text.length === 0) return undefined;

  switch (type) {
    case "title":
      return {
        title: [{ type: "text", text: { content: text.slice(0, 2000) } }],
      };
    case "rich_text":
      return {
        rich_text: [{ type: "text", text: { content: text.slice(0, 2000) } }],
      };
    case "number": {
      const parsed = Number(text.replace(/[^0-9.eE+-]/g, ""));
      return Number.isFinite(parsed) ? { number: parsed } : undefined;
    }
    case "select":
      return { select: { name: text } };
    case "multi_select":
      return {
        multi_select: text
          .split(",")
          .map((name) => name.trim())
          .filter(Boolean)
          .map((name) => ({ name })),
      };
    case "status":
      return { status: { name: text } };
    case "date":
      // Notion wants ISO-8601. A date it cannot parse is rejected for the
      // whole page, so an unusable value is skipped instead.
      return Number.isNaN(Date.parse(text))
        ? undefined
        : { date: { start: text } };
    case "checkbox":
      return { checkbox: /^(true|yes|1|on|checked)$/i.test(text) };
    case "url":
      return { url: text };
    case "email":
      return { email: text };
    case "phone_number":
      return { phone_number: text };
    case "people":
      return {
        people: text
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean)
          .map((id) => ({ object: "user", id })),
      };
    default:
      // Formula, rollup, created_time and friends are computed by Notion and
      // cannot be written at all.
      return undefined;
  }
}

/** Flatten a Notion property value back to something a workflow can read. */
export function readNotionProperty(property: unknown): unknown {
  if (!property || typeof property !== "object") return null;
  const p = property as Record<string, unknown>;

  switch (p.type) {
    case "title":
    case "rich_text": {
      const parts = (p[p.type as string] ?? []) as Array<{
        plain_text?: string;
      }>;
      return parts.map((part) => part.plain_text ?? "").join("");
    }
    case "number":
      return p.number ?? null;
    case "select":
      return (p.select as { name?: string } | null)?.name ?? null;
    case "status":
      return (p.status as { name?: string } | null)?.name ?? null;
    case "multi_select":
      return ((p.multi_select ?? []) as Array<{ name?: string }>).map(
        (o) => o.name ?? "",
      );
    case "date":
      return (p.date as { start?: string } | null)?.start ?? null;
    case "checkbox":
      return Boolean(p.checkbox);
    case "url":
    case "email":
    case "phone_number":
      return p[p.type as string] ?? null;
    case "people":
      return ((p.people ?? []) as Array<{ name?: string; id?: string }>).map(
        (u) => u.name ?? u.id ?? "",
      );
    case "formula": {
      const f = (p.formula ?? {}) as Record<string, unknown>;
      return f.string ?? f.number ?? f.boolean ?? f.date ?? null;
    }
    default:
      return null;
  }
}
