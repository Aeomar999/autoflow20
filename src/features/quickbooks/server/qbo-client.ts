import "server-only";
import { NonRetriableError, RetryAfterError } from "inngest";
import type { CredentialSecret } from "@/features/credentials/server/vault";
import { serviceEndpoint } from "@/lib/server/service-endpoints";

/**
 * The one QuickBooks Online API client (AF-M10-16).
 *
 * 10 of the 35 reference automations touch QBO — the largest single-service
 * dependency in the milestone. Four things every QBO node needs, each easy to
 * get subtly wrong once per node:
 *
 * 1. **The base URL comes from the credential**, because sandbox and
 *    production are different hosts holding different companies.
 * 2. **The minor version is pinned**, because Intuit changes response shapes
 *    within a major version.
 * 3. **Query values are escaped**, because QBO's `query` endpoint speaks a
 *    SQL-like language and a customer called "O'Brien Ltd" is ordinary.
 * 4. **Errors are classified by whether retrying could possibly help.**
 */

/**
 * Pinned. Intuit ships breaking response changes inside v3 behind minor
 * versions, and an unpinned request silently gets whatever is current — so a
 * field that exists today can vanish on a Tuesday with no deploy on our side.
 * Bumping this is a deliberate change with a changelog to read, which is the
 * whole point of pinning it.
 */
export const QBO_MINOR_VERSION = 75;

const REQUEST_TIMEOUT_MS = 30_000;

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

/** QBO's own ceiling on a single query page. */
export const QBO_MAX_PAGE_SIZE = 1000;

/** Pages one query will walk before reporting truncation. */
export const QBO_MAX_PAGE_BUDGET = 10;

/**
 * Where a connection points.
 *
 * **Sandbox vs production is a property of the connection, not of a node.**
 * The source templates make it node config, which is how they end up shipping
 * with a sandbox company id baked into a workflow that someone then runs
 * against their real books — or, worse, points at production while still
 * carrying sandbox item ids. Here it is captured at connect time
 * (`intuit.oauth2` → `captureExtras`) and a node cannot override it.
 */
const QBO_HOSTS = {
  production: () => serviceEndpoint("qbo-production"),
  sandbox: () => serviceEndpoint("qbo-sandbox"),
} as const;

export interface QboConnection {
  accessToken: string;
  realmId: string;
  baseUrl: string;
  environment: "sandbox" | "production";
}

/**
 * Read the connection out of a resolved credential.
 *
 * `realmId` is the company id and it is **never** node config: a workflow that
 * could name its own realm would let one connection write to a company it was
 * not authorised for, and would silently keep working after the user
 * reconnected a different company.
 */
export function resolveQboConnection(
  secret: CredentialSecret | undefined,
  where: string,
): QboConnection {
  const accessToken = secret?.accessToken;
  if (!accessToken) {
    throw new NonRetriableError(
      `${where}: no QuickBooks credential is bound to this node, or the connection has no access token. Connect a QuickBooks Online credential.`,
    );
  }

  const realmId = secret?.realmId;
  if (!realmId) {
    throw new NonRetriableError(
      `${where}: the QuickBooks credential has no company id (realmId). Reconnect it — the company is captured during the connect flow, and a credential without one predates that.`,
    );
  }

  // Anything that is not exactly "sandbox" is production. Defaulting the other
  // way would point a misconfigured connection at a company that does not
  // exist and read as "not found"; this way it fails loudly against the real
  // company instead of quietly succeeding against a fake one.
  const environment =
    secret?.environment === "sandbox" ? "sandbox" : "production";

  return {
    accessToken,
    realmId,
    environment,
    baseUrl: `${QBO_HOSTS[environment]()}/v3/company/${encodeURIComponent(realmId)}`,
  };
}

export interface QboError {
  status: number;
  message: string;
  /** Intuit's numeric error code, e.g. "6240" for a duplicate name. */
  code?: string;
  detail?: string;
}

/**
 * Turn a QBO failure into the right kind of engine error.
 *
 * The split is "could a retry conceivably succeed?". Intuit throttles at 500
 * requests per minute per realm and answers 429; that is worth waiting out. A
 * validation fault — a line item with no amount, a customer that already
 * exists — is the same on every attempt, and retrying it three times only
 * delays the message the user needs to read.
 */
export function classifyQboError(error: QboError): Error {
  const { status, message, code, detail } = error;
  const full = detail ? `${message} — ${detail}` : message;

  if (status === 429) {
    return new RetryAfterError(
      `QuickBooks is throttling this connection (429): ${full}`,
      60,
    );
  }

  if (status >= 500) {
    return new RetryAfterError(
      `QuickBooks is unavailable (${status}): ${full}`,
      15,
    );
  }

  if (status === 401) {
    return new NonRetriableError(
      `QuickBooks rejected the credential (401): ${full}. Reconnect the QuickBooks credential — retrying will not fix an expired or revoked token.`,
    );
  }

  if (status === 403) {
    return new NonRetriableError(
      `QuickBooks refused the request (403): ${full}. The connected company may not have this feature enabled, or the connection lacks the accounting scope.`,
    );
  }

  if (status === 404) {
    return new NonRetriableError(
      `QuickBooks could not find it (404): ${full}. Check the id — a record that does not exist will not appear on a retry.`,
    );
  }

  // 6240 is "Duplicate Name Exists in the table" — the single most common QBO
  // write failure, and the one whose default message ("Business Validation
  // Error") tells the user nothing about what to do.
  if (code === "6240") {
    return new NonRetriableError(
      `QuickBooks already has a record with that name (6240): ${full}. Look the record up first (QBO_FIND_CUSTOMER) and create only when the search returns nothing.`,
    );
  }

  return new NonRetriableError(`QuickBooks error ${status}: ${full}`);
}

/** Pull Intuit's `Fault` structure out of a response body. */
function parseQboError(status: number, body: string): QboError {
  try {
    const parsed = JSON.parse(body) as {
      Fault?: {
        Error?: Array<{ Message?: string; Detail?: string; code?: string }>;
      };
      fault?: {
        error?: Array<{ message?: string; detail?: string; code?: string }>;
      };
    };
    // Intuit answers with `Fault` from the accounting API and lowercase
    // `fault` from the OAuth/platform tier. Same shape, different casing.
    const first = parsed.Fault?.Error?.[0];
    const lower = parsed.fault?.error?.[0];
    const message = first?.Message ?? lower?.message;
    if (message) {
      return {
        status,
        message,
        detail: first?.Detail ?? lower?.detail,
        code: first?.code ?? lower?.code,
      };
    }
  } catch {
    // Fall through to the raw body.
  }
  return { status, message: body.slice(0, 300) || "no response body" };
}

export interface QboRequest {
  /** Path below `/v3/company/{realmId}`, e.g. `"customer"` or `"invoice/42"`. */
  path: string;
  method?: "GET" | "POST";
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** Node name, for error messages a user can act on. */
  where: string;
}

const buildUrl = (
  connection: QboConnection,
  request: Pick<QboRequest, "path" | "query">,
): URL => {
  const url = new URL(
    `${connection.baseUrl}/${request.path.replace(/^\//, "")}`,
  );
  for (const [key, value] of Object.entries(request.query ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }
  url.searchParams.set("minorversion", String(QBO_MINOR_VERSION));
  return url;
};

/** One authenticated QBO API call. */
export async function qboFetch<T>(
  connection: QboConnection,
  request: QboRequest,
): Promise<T> {
  const url = buildUrl(connection, request);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${connection.accessToken}`,
    Accept: "application/json",
  };

  let body: BodyInit | undefined;
  if (request.body !== undefined) {
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
    const classified = classifyQboError(parseQboError(response.status, text));
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
      `${request.where}: QuickBooks returned a response that is not JSON.`,
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
        `QuickBooks response exceeded the ${MAX_RESPONSE_BYTES}-byte limit. Narrow the query or reduce the page size.`,
      );
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

/** Raw bytes from a QBO endpoint — currently the invoice PDF. */
export async function qboFetchBytes(
  connection: QboConnection,
  request: QboRequest & { accept: string; maxBytes: number },
): Promise<Buffer> {
  const url = buildUrl(connection, request);

  const response = await fetch(url, {
    method: request.method ?? "GET",
    headers: {
      Authorization: `Bearer ${connection.accessToken}`,
      Accept: request.accept,
    },
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    const classified = classifyQboError(
      parseQboError(response.status, await response.text()),
    );
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
        `${request.where}: the document exceeds the ${request.maxBytes}-byte limit for this node.`,
      );
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/**
 * A multipart upload to QBO's `/upload` endpoint.
 *
 * Here rather than in the caller so that URL construction, the minor-version
 * pin and error classification stay in one place — an upload that quietly used
 * a different minor version than every other call is exactly the drift the pin
 * exists to prevent.
 */
export async function qboUpload<T>(
  connection: QboConnection,
  request: {
    body: Buffer;
    boundary: string;
    where: string;
  },
): Promise<T> {
  const url = buildUrl(connection, { path: "upload" });

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${connection.accessToken}`,
      Accept: "application/json",
      "Content-Type": `multipart/form-data; boundary=${request.boundary}`,
    },
    body: new Uint8Array(request.body),
    signal: AbortSignal.timeout(120_000),
  });

  const text = await readCapped(response);

  if (!response.ok) {
    const classified = classifyQboError(parseQboError(response.status, text));
    classified.message = `${request.where}: ${classified.message}`;
    throw classified;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new NonRetriableError(
      `${request.where}: QuickBooks returned a response that is not JSON.`,
    );
  }
}

/**
 * Escape a value for a QBO query literal.
 *
 * The `query` endpoint speaks a SQL-like language, and values go into
 * single-quoted strings. An unescaped apostrophe closes the string and the
 * rest is parsed as syntax — "O'Brien Ltd" is an ordinary company name, and
 * `DisplayName = 'O'Brien Ltd'` is a syntax error at best. Intuit escapes with
 * a backslash, so the backslash itself must be escaped first or it would
 * consume the quote that follows it.
 */
export function escapeQboQuery(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/**
 * Run a QBO SELECT, paginated and bounded.
 *
 * QBO paginates with `STARTPOSITION`/`MAXRESULTS` appended to the query text
 * rather than with a page token, and it is 1-indexed — a `STARTPOSITION 0`
 * request returns the same first page forever, which is an infinite loop that
 * looks like a working one.
 */
export async function qboQuery<T>(
  connection: QboConnection,
  args: {
    /** SELECT without STARTPOSITION/MAXRESULTS — this adds them. */
    select: string;
    /** The `QueryResponse` key holding the rows, e.g. `"Customer"`. */
    entity: string;
    limit: number;
    where: string;
  },
): Promise<{ items: T[]; truncated: boolean }> {
  const pageSize = Math.min(args.limit, QBO_MAX_PAGE_SIZE);
  const items: T[] = [];
  // 1-indexed, not 0. Intuit treats 0 as 1, so a loop that starts at 0 and
  // adds the page size re-reads the first page's tail forever.
  let startPosition = 1;
  let pages = 0;

  while (pages < QBO_MAX_PAGE_BUDGET) {
    const page = await qboFetch<{
      QueryResponse?: Record<string, unknown> & { maxResults?: number };
    }>(connection, {
      path: "query",
      query: {
        query: `${args.select} STARTPOSITION ${startPosition} MAXRESULTS ${pageSize}`,
      },
      where: args.where,
    });

    const rows = page.QueryResponse?.[args.entity];
    const batch = Array.isArray(rows) ? (rows as T[]) : [];
    items.push(...batch);
    pages += 1;

    if (items.length >= args.limit) {
      return { items: items.slice(0, args.limit), truncated: true };
    }
    // A short page is the last page: QBO has no "next" marker, so a page
    // smaller than the one requested is the only end-of-results signal.
    if (batch.length < pageSize) {
      return { items, truncated: false };
    }

    startPosition += batch.length;
  }

  return { items: items.slice(0, args.limit), truncated: true };
}
