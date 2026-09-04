import "server-only";
import { NonRetriableError, RetryAfterError } from "inngest";
import type { CredentialSecret } from "@/features/credentials/server/vault";

/**
 * The Airtable client for the AF-M10-20 nodes.
 *
 * `AIRTABLE_CREATE_RECORD` predates this and carries its own inline fetch. The
 * task says to leave that node untouched, so this does not refactor it — which
 * means two callers of the same API for now. That is a wart, not a design:
 * the create node should move onto this client the next time it is opened for
 * another reason.
 *
 * **`typecast` is never enabled.** With it on, Airtable coerces whatever you
 * send into the column's type and will *create new select options* to make a
 * write succeed. A workflow writing "Hight" into a status column would silently
 * add "Hight" as a valid status rather than failing, and nobody finds out until
 * someone opens the view.
 */

const AIRTABLE_API = "https://api.airtable.com/v0";
const REQUEST_TIMEOUT_MS = 30_000;

/** Airtable's own page size, and its hard cap. */
export const AIRTABLE_PAGE_SIZE = 100;

/** Records one node will read. A base can hold 50,000. */
export const AIRTABLE_MAX_RECORDS = 5_000;

export interface AirtableRecord {
  id: string;
  createdTime?: string;
  fields: Record<string, unknown>;
}

interface AirtableErrorBody {
  error?: { type?: string; message?: string } | string;
}

function classify(
  status: number,
  headers: Headers,
  body: AirtableErrorBody,
  where: string,
) {
  const error = body.error;
  const type = typeof error === "string" ? error : (error?.type ?? "");
  const message = typeof error === "string" ? "" : (error?.message ?? "");

  if (status === 401 || status === 403) {
    return new NonRetriableError(
      `${where}: Airtable rejected the token${message ? `: ${message}` : ""}. Check the personal access token has access to this base — Airtable PATs are scoped per base, so a token that works elsewhere can still be refused here.`,
    );
  }

  if (status === 404) {
    return new NonRetriableError(
      `${where}: Airtable returned 404. Check the base id (starts "app") and the table id or name${message ? `: ${message}` : ""}.`,
    );
  }

  if (status === 422 || type === "INVALID_FILTER_BY_FORMULA") {
    return new NonRetriableError(
      `${where}: Airtable rejected the request${message ? `: ${message}` : ""}. A filterByFormula must use the column's display name in braces, e.g. {Status} = "Active".`,
    );
  }

  if (status === 429) {
    // Airtable's limit is 5 requests/second per base and it does not send
    // Retry-After. Its own guidance is to wait 30 seconds.
    return new RetryAfterError(
      `${where}: Airtable rate limit hit (5 requests/second per base).`,
      30,
    );
  }

  if (status >= 500) {
    return new RetryAfterError(
      `${where}: Airtable is unavailable (${status}).`,
      15,
    );
  }

  return new NonRetriableError(
    `${where}: Airtable refused the request (${status})${message ? `: ${message}` : ""}.`,
  );
}

export interface AirtableRequest {
  baseId: string;
  table: string;
  method?: "GET" | "POST" | "PATCH";
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  /** Appended after the table, e.g. a record id. */
  recordPath?: string;
  where: string;
}

export async function airtableFetch<T>(
  secret: CredentialSecret | undefined,
  request: AirtableRequest,
): Promise<T> {
  const apiKey = secret?.apiKey;
  if (!apiKey) {
    throw new NonRetriableError(
      `${request.where}: no Airtable credential is bound to this node. Connect an Airtable credential.`,
    );
  }

  const url = new URL(
    `${AIRTABLE_API}/${encodeURIComponent(request.baseId)}/${encodeURIComponent(
      request.table,
    )}${request.recordPath ? `/${encodeURIComponent(request.recordPath)}` : ""}`,
  );
  for (const [key, value] of Object.entries(request.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, {
    method: request.method ?? "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      ...(request.body ? { "Content-Type": "application/json" } : {}),
    },
    body: request.body ? JSON.stringify(request.body) : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const payload = (await response.json().catch(() => ({}))) as T &
    AirtableErrorBody;

  if (!response.ok) {
    throw classify(response.status, response.headers, payload, request.where);
  }

  return payload;
}

/**
 * List records, bounded, following Airtable's offset cursor.
 *
 * `filterByFormula` runs server-side, which matters for cost as well as speed:
 * without it the node pages the whole table to find three rows, and Airtable
 * meters requests per base.
 */
export async function listAirtableRecords(args: {
  secret: CredentialSecret | undefined;
  baseId: string;
  table: string;
  filterByFormula?: string;
  view?: string;
  sortField?: string;
  sortDirection?: "asc" | "desc";
  fields?: string[];
  limit: number;
  where: string;
}): Promise<{ records: AirtableRecord[]; truncated: boolean }> {
  const records: AirtableRecord[] = [];
  let offset: string | undefined;
  const maxPages = Math.ceil(
    Math.min(args.limit, AIRTABLE_MAX_RECORDS) / AIRTABLE_PAGE_SIZE,
  );

  for (let page = 0; page < maxPages; page += 1) {
    const query: Record<string, string | number | undefined> = {
      pageSize: Math.min(args.limit - records.length, AIRTABLE_PAGE_SIZE),
      ...(args.filterByFormula
        ? { filterByFormula: args.filterByFormula }
        : {}),
      ...(args.view ? { view: args.view } : {}),
      ...(offset ? { offset } : {}),
    };

    // Airtable's sort and fields parameters are indexed, not comma-separated.
    if (args.sortField) {
      query["sort[0][field]"] = args.sortField;
      query["sort[0][direction]"] = args.sortDirection ?? "asc";
    }
    args.fields?.forEach((field, index) => {
      query[`fields[${index}]`] = field;
    });

    const page_ = await airtableFetch<{
      records?: AirtableRecord[];
      offset?: string;
    }>(args.secret, {
      baseId: args.baseId,
      table: args.table,
      query,
      where: args.where,
    });

    records.push(...(page_.records ?? []));
    offset = page_.offset;

    if (!offset || records.length >= args.limit) break;
  }

  return {
    records: records.slice(0, args.limit),
    truncated: Boolean(offset) && records.length >= args.limit,
  };
}

/**
 * Update one record's fields.
 *
 * PATCH, not PUT: PUT clears every field the request does not mention, which
 * turns "set the status" into "delete everything else on the row".
 */
export async function updateAirtableRecord(args: {
  secret: CredentialSecret | undefined;
  baseId: string;
  table: string;
  recordId: string;
  fields: Record<string, unknown>;
  where: string;
}): Promise<AirtableRecord> {
  return airtableFetch<AirtableRecord>(args.secret, {
    baseId: args.baseId,
    table: args.table,
    recordPath: args.recordId,
    method: "PATCH",
    body: {
      fields: args.fields,
      // Explicit, not defaulted. See the module comment: typecast makes
      // Airtable invent select options to force a write through.
      typecast: false,
    },
    where: args.where,
  });
}
