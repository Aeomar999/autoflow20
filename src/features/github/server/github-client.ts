import "server-only";
import { NonRetriableError, RetryAfterError } from "inngest";
import type { CredentialSecret } from "@/features/credentials/server/vault";

/**
 * The one GitHub REST client (AF-M10-18).
 *
 * GitHub's failure modes are mostly about *rate limits* and *permissions*, and
 * both are easy to get wrong in ways that look like something else:
 *
 * - It runs two separate limiters. The primary one answers 403 with
 *   `x-ratelimit-remaining: 0` and a reset timestamp; the secondary ("abuse")
 *   one answers 403 with `retry-after` and no remaining counter. Treating
 *   either as a permission error — which is what a bare 403 check does — turns
 *   a wait-and-succeed into a permanent failure.
 * - It answers **404, not 403**, for a private repository the token cannot
 *   see. That is deliberate, so you cannot probe for existence. Reporting it
 *   as "repository not found" sends people hunting for a typo when the real
 *   cause is a missing scope or an org that has not approved the OAuth app.
 */

const GITHUB_API = "https://api.github.com";
const REQUEST_TIMEOUT_MS = 30_000;

/** Pages one listing will walk. A bound, not a guess. */
export const GITHUB_MAX_PAGE_BUDGET = 10;

export interface GithubRequest {
  /** Path below the API root, e.g. `"/repos/acme/web/pulls"`. */
  path: string;
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  /** Node name, for errors a user can act on. */
  where: string;
}

interface GithubErrorBody {
  message?: string;
  errors?: Array<{ message?: string; resource?: string; field?: string }>;
}

/** Turn a GitHub 4xx/5xx into the right kind of engine error. */
function classify(
  status: number,
  headers: Headers,
  body: GithubErrorBody | undefined,
  where: string,
): Error {
  const detail =
    body?.errors
      ?.map((e) => e.message)
      .filter(Boolean)
      .join("; ") ||
    body?.message ||
    "";

  if (status === 401) {
    return new NonRetriableError(
      `${where}: GitHub rejected the credential. Reconnect the GitHub connection — retrying will not fix an expired or revoked token.`,
    );
  }

  if (status === 403 || status === 429) {
    const remaining = headers.get("x-ratelimit-remaining");
    const retryAfter = headers.get("retry-after");

    // Secondary (abuse) limit: retry-after, no remaining counter.
    if (retryAfter) {
      const seconds = Number(retryAfter);
      return new RetryAfterError(
        `${where}: GitHub secondary rate limit hit.`,
        Number.isFinite(seconds) ? seconds : 60,
      );
    }

    // Primary limit: the counter is exhausted and reset is an epoch second.
    if (remaining === "0") {
      const reset = Number(headers.get("x-ratelimit-reset"));
      const waitSeconds = Number.isFinite(reset)
        ? Math.max(1, Math.ceil(reset - Date.now() / 1000))
        : 60;
      return new RetryAfterError(
        `${where}: GitHub rate limit exhausted; it resets in ${waitSeconds}s.`,
        Math.min(waitSeconds, 3600),
      );
    }

    // A real permission problem.
    return new NonRetriableError(
      `${where}: GitHub refused the request (403)${detail ? `: ${detail}` : ""}. The token may lack the "repo" scope, or the organisation may not have approved this OAuth app.`,
    );
  }

  if (status === 404) {
    // The important one: GitHub hides private repositories behind 404.
    return new NonRetriableError(
      `${where}: GitHub returned 404. Either the path does not exist, or the token cannot see it — GitHub answers 404 rather than 403 for private repositories, so check the token's "repo" scope and that the organisation has approved this app before assuming a typo.`,
    );
  }

  if (status === 422) {
    return new NonRetriableError(
      `${where}: GitHub rejected the request as invalid (422)${detail ? `: ${detail}` : ""}.`,
    );
  }

  if (status >= 500) {
    return new RetryAfterError(
      `${where}: GitHub is unavailable (${status}).`,
      15,
    );
  }

  return new NonRetriableError(
    `${where}: GitHub request failed (${status})${detail ? `: ${detail}` : ""}.`,
  );
}

interface GithubResponse<T> {
  data: T;
  headers: Headers;
}

async function githubRaw<T>(
  secret: CredentialSecret | undefined,
  request: GithubRequest,
): Promise<GithubResponse<T>> {
  const accessToken = secret?.accessToken;
  if (!accessToken) {
    throw new NonRetriableError(
      `${request.where}: no GitHub credential is bound to this node. Connect a GitHub credential.`,
    );
  }

  const url = new URL(`${GITHUB_API}${request.path}`);
  for (const [key, value] of Object.entries(request.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, {
    method: request.method ?? "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      // Pinning the API version keeps a future GitHub default from silently
      // changing response shapes under a running workflow.
      "X-GitHub-Api-Version": "2022-11-28",
      ...(request.body ? { "Content-Type": "application/json" } : {}),
    },
    body: request.body ? JSON.stringify(request.body) : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    let parsed: GithubErrorBody | undefined;
    try {
      parsed = (await response.json()) as GithubErrorBody;
    } catch {
      parsed = undefined;
    }
    throw classify(response.status, response.headers, parsed, request.where);
  }

  if (response.status === 204) {
    return { data: undefined as T, headers: response.headers };
  }

  return { data: (await response.json()) as T, headers: response.headers };
}

/** One authenticated GitHub REST call. */
export async function githubFetch<T>(
  secret: CredentialSecret | undefined,
  request: GithubRequest,
): Promise<T> {
  const { data } = await githubRaw<T>(secret, request);
  return data;
}

/**
 * Walk a paginated listing, bounded.
 *
 * GitHub pages with a `Link` header rather than a cursor in the body, and a
 * busy repository has tens of thousands of commits — following `rel="next"`
 * until it runs out is an unbounded sequence of rate-limited requests.
 * Truncation is reported rather than implied.
 */
export async function githubPaginate<TItem>(
  secret: CredentialSecret | undefined,
  args: GithubRequest & { limit: number },
): Promise<{ items: TItem[]; truncated: boolean }> {
  const items: TItem[] = [];
  let page = 1;

  while (page <= GITHUB_MAX_PAGE_BUDGET) {
    const { data, headers } = await githubRaw<TItem[]>(secret, {
      ...args,
      query: {
        ...args.query,
        per_page: Math.min(args.limit - items.length, 100),
        page,
      },
    });

    if (!Array.isArray(data)) break;
    items.push(...data);

    if (items.length >= args.limit) {
      return { items: items.slice(0, args.limit), truncated: true };
    }
    // No rel="next" in the Link header means this was the last page.
    if (!(headers.get("link") ?? "").includes('rel="next"')) {
      return { items, truncated: false };
    }
    page += 1;
  }

  return { items: items.slice(0, args.limit), truncated: true };
}

/**
 * Split `owner/repo` into its parts.
 *
 * Accepts a full URL too, because that is what people paste. Without this a
 * pasted URL becomes a 404 whose message talks about permissions, which is
 * the least useful place to start debugging a typo.
 */
export function parseRepo(
  raw: string,
  where: string,
): { owner: string; repo: string } {
  const trimmed = raw
    .trim()
    .replace(/^https?:\/\/(www\.)?github\.com\//i, "")
    .replace(/\.git$/i, "")
    .replace(/^\/+|\/+$/g, "");

  const [owner, repo] = trimmed.split("/");
  if (!owner || !repo) {
    throw new NonRetriableError(
      `${where}: "${raw}" is not a repository. Use owner/repo, like "acme/web".`,
    );
  }
  return { owner, repo };
}
