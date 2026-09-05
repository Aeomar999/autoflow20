import "server-only";
import { NonRetriableError, RetryAfterError } from "inngest";
import type { CredentialSecret } from "@/features/credentials/server/vault";
import { serviceEndpoint } from "@/lib/server/service-endpoints";

/**
 * The one Apify client (AF-M10-19).
 *
 * Apify is metered: an actor run bills compute units for every second it is
 * alive, whether or not anything is still waiting for it. That makes two
 * things load-bearing here rather than nice to have:
 *
 * 1. **A run this node stops waiting on is aborted, not orphaned.** If the
 *    wait times out or the workflow is cancelled, the actor keeps scraping and
 *    keeps billing unless someone tells it to stop. An orphaned run is a bill,
 *    not a bug report.
 * 2. **Every listing is bounded.** A crawl of a large site produces tens of
 *    thousands of items; pulling all of them into a run context is how an
 *    execution record becomes unreadable and a worker runs out of memory.
 */

const REQUEST_TIMEOUT_MS = 30_000;

/** Terminal run states. Everything else means "still going". */
const TERMINAL_STATUSES = new Set([
  "SUCCEEDED",
  "FAILED",
  "TIMED-OUT",
  "ABORTED",
]);

export interface ApifyRun {
  id: string;
  actId?: string;
  status: string;
  defaultDatasetId?: string;
  defaultKeyValueStoreId?: string;
  startedAt?: string;
  finishedAt?: string;
  stats?: {
    computeUnits?: number;
    runTimeSecs?: number;
  };
  exitCode?: number;
}

export interface ApifyRequest {
  path: string;
  method?: "GET" | "POST";
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  /** Node name, for errors a user can act on. */
  where: string;
}

function classify(
  status: number,
  headers: Headers,
  text: string,
  where: string,
) {
  let message = "";
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } };
    message = parsed.error?.message ?? "";
  } catch {
    message = text.slice(0, 200);
  }

  if (status === 401 || status === 403) {
    return new NonRetriableError(
      `${where}: Apify rejected the API token${message ? `: ${message}` : ""}. Reconnect the Apify credential — retrying will not fix a revoked token.`,
    );
  }
  if (status === 404) {
    return new NonRetriableError(
      `${where}: Apify returned 404${message ? `: ${message}` : ""}. Check the actor id — it is "username~actor-name", not the actor's display name.`,
    );
  }
  if (status === 429) {
    const retryAfter = Number(headers.get("retry-after") ?? "20");
    return new RetryAfterError(
      `${where}: Apify rate limit hit.`,
      Number.isFinite(retryAfter) ? retryAfter : 20,
    );
  }
  if (status >= 500) {
    return new RetryAfterError(
      `${where}: Apify is unavailable (${status}).`,
      15,
    );
  }
  return new NonRetriableError(
    `${where}: Apify refused the request (${status})${message ? `: ${message}` : ""}.`,
  );
}

/** One authenticated Apify API call. */
export async function apifyFetch<T>(
  secret: CredentialSecret | undefined,
  request: ApifyRequest,
): Promise<T> {
  const apiKey = secret?.apiKey;
  if (!apiKey) {
    throw new NonRetriableError(
      `${request.where}: no Apify credential is bound to this node. Connect an Apify credential.`,
    );
  }

  const url = new URL(`${serviceEndpoint("apify")}${request.path}`);
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

  const text = await response.text();
  if (!response.ok) {
    throw classify(response.status, response.headers, text, request.where);
  }

  if (text.length === 0) return undefined as T;

  // Most endpoints wrap the payload in `{ data: ... }`; the dataset items
  // endpoint returns a bare array.
  const parsed = JSON.parse(text) as { data?: T } | T;
  if (parsed && typeof parsed === "object" && "data" in parsed) {
    return (parsed as { data: T }).data;
  }
  return parsed as T;
}

/**
 * Start an actor run without waiting for it.
 *
 * `waitForFinish` is deliberately NOT used. Apify's own wait caps at 60s and
 * holds the HTTP connection open, which would park a worker on a scrape that
 * routinely takes minutes. The node polls with durable sleeps instead, so the
 * worker is free and the run survives a redeploy.
 */
export async function startApifyRun(args: {
  secret: CredentialSecret | undefined;
  actorId: string;
  input?: unknown;
  memoryMbytes?: number;
  timeoutSecs?: number;
  where: string;
}): Promise<ApifyRun> {
  // Apify's path form is `username~actor-name`; people paste `username/actor`
  // from the console URL, which 404s in a way that reads like a missing actor.
  const actorPath = args.actorId.trim().replace(/\//g, "~");

  const run = await apifyFetch<ApifyRun>(args.secret, {
    path: `/acts/${encodeURIComponent(actorPath)}/runs`,
    method: "POST",
    body: args.input ?? {},
    query: {
      ...(args.memoryMbytes ? { memory: args.memoryMbytes } : {}),
      // Apify's own run timeout, a backstop under the node's wait: if the node
      // dies between polls the run still stops on its own rather than billing
      // until someone notices.
      ...(args.timeoutSecs ? { timeout: args.timeoutSecs } : {}),
    },
    where: args.where,
  });

  if (!run?.id) {
    throw new NonRetriableError(
      `${args.where}: Apify accepted the request but returned no run id.`,
    );
  }
  return run;
}

export async function getApifyRun(args: {
  secret: CredentialSecret | undefined;
  runId: string;
  where: string;
}): Promise<ApifyRun> {
  return apifyFetch<ApifyRun>(args.secret, {
    path: `/actor-runs/${args.runId}`,
    where: args.where,
  });
}

/**
 * Stop a run this workflow is no longer waiting on.
 *
 * Called on timeout and on cancellation. Failure here is logged into the
 * thrown message rather than replacing it: the caller is already reporting
 * something worse, and "we could not abort it either" is a detail of that, not
 * a separate error that would hide the original cause.
 */
export async function abortApifyRun(args: {
  secret: CredentialSecret | undefined;
  runId: string;
  where: string;
}): Promise<boolean> {
  try {
    await apifyFetch(args.secret, {
      path: `/actor-runs/${args.runId}/abort`,
      method: "POST",
      where: args.where,
    });
    return true;
  } catch {
    return false;
  }
}

export function isTerminal(status: string): boolean {
  return TERMINAL_STATUSES.has(status.toUpperCase());
}

/**
 * Read a run's outcome into a sentence.
 *
 * Apify reports actor failure as a *successful* API response describing a
 * FAILED run — the call worked, the work did not. Without this the node would
 * report success and hand an empty dataset downstream.
 */
export function describeRunOutcome(
  run: ApifyRun,
  where: string,
): NonRetriableError | undefined {
  const status = run.status?.toUpperCase();

  if (status === "SUCCEEDED") return undefined;

  if (status === "FAILED") {
    return new NonRetriableError(
      `${where}: the actor run failed (exit code ${run.exitCode ?? "unknown"}). Open the run in Apify to see its log — the input is the usual cause.`,
    );
  }
  if (status === "TIMED-OUT") {
    return new NonRetriableError(
      `${where}: the actor hit its own Apify timeout after ${run.stats?.runTimeSecs ?? "?"}s. Raise the run timeout, or narrow what the actor is asked to do.`,
    );
  }
  if (status === "ABORTED") {
    return new NonRetriableError(
      `${where}: the actor run was aborted before it finished.`,
    );
  }
  return new NonRetriableError(
    `${where}: the actor run ended in an unexpected state (${run.status}).`,
  );
}

/**
 * Fetch dataset items, bounded.
 *
 * `limit` is a hard ceiling and truncation is reported rather than implied: a
 * workflow that silently processed the first thousand of forty thousand rows
 * looks like it worked.
 */
export async function fetchApifyDataset<TItem>(args: {
  secret: CredentialSecret | undefined;
  datasetId: string;
  limit: number;
  offset?: number;
  /** Drop empty items and Apify's internal `#` fields. */
  clean?: boolean;
  where: string;
}): Promise<{ items: TItem[]; truncated: boolean; total: number }> {
  const pageSize = 1000;
  const items: TItem[] = [];
  let offset = args.offset ?? 0;

  while (items.length < args.limit) {
    const batch = await apifyFetch<TItem[]>(args.secret, {
      path: `/datasets/${args.datasetId}/items`,
      query: {
        limit: Math.min(args.limit - items.length, pageSize),
        offset,
        ...(args.clean ? { clean: "true" } : {}),
      },
      where: args.where,
    });

    if (!Array.isArray(batch) || batch.length === 0) {
      return { items, truncated: false, total: items.length };
    }

    items.push(...batch);
    offset += batch.length;

    // A short page is the last page.
    if (batch.length < pageSize) {
      return { items, truncated: false, total: items.length };
    }
  }

  // We stopped because the cap was reached, so there may well be more.
  return {
    items: items.slice(0, args.limit),
    truncated: true,
    total: items.length,
  };
}
