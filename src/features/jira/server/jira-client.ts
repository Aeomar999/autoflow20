import "server-only";
import { NonRetriableError, RetryAfterError } from "inngest";
import type { CredentialSecret } from "@/features/credentials/server/vault";

/**
 * The one Jira Cloud client (AF-M10-18).
 *
 * Three things about Jira Cloud that are not optional to get right:
 *
 * 1. **The base URL is per-site and lives in the credential.** Jira Cloud is
 *    reached at `api.atlassian.com/ex/jira/{cloudId}`, not at the site's own
 *    `*.atlassian.net` domain, and the cloud id was resolved during the OAuth
 *    exchange (`postExchange` on the atlassian provider).
 * 2. **Rich text is ADF, not a string.** The v3 API takes descriptions and
 *    comments as an Atlassian Document Format tree. Passing a plain string —
 *    which every v2 example on the internet does — is rejected with a message
 *    about "operation value must be an object" that says nothing about ADF.
 * 3. **Transitions are per-project and identified by id.** Those ids differ
 *    between projects, so a workflow that hardcodes "31" works in the project
 *    it was written against and silently breaks everywhere else. Resolving by
 *    NAME is the whole point of `matchTransition` below.
 */

const ATLASSIAN_API = "https://api.atlassian.com";
const REQUEST_TIMEOUT_MS = 30_000;

export interface JiraRequest {
  /** Path below the Jira REST root, e.g. `"/issue"`. */
  path: string;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  /** Node name, for errors a user can act on. */
  where: string;
  /** REST API version. Defaults to 3; attachments still live on 3 too. */
  apiVersion?: "2" | "3";
}

interface JiraErrorBody {
  errorMessages?: string[];
  errors?: Record<string, string>;
  message?: string;
}

/** Read the cloud id the OAuth exchange stored, or say what to do about it. */
function requireCloudId(
  secret: CredentialSecret | undefined,
  where: string,
): { cloudId: string; accessToken: string } {
  const accessToken = secret?.accessToken;
  if (!accessToken) {
    throw new NonRetriableError(
      `${where}: no Jira credential is bound to this node. Connect an Atlassian credential.`,
    );
  }
  const cloudId = secret?.cloudId;
  if (!cloudId) {
    // Reconnecting is the fix: the cloud id is resolved once, at authorise
    // time, from the accessible-resources endpoint.
    throw new NonRetriableError(
      `${where}: the Jira credential has no cloud id stored. Reconnect the Atlassian credential so the site can be resolved.`,
    );
  }
  return { cloudId, accessToken };
}

function classify(
  status: number,
  headers: Headers,
  body: JiraErrorBody | undefined,
  where: string,
): Error {
  const detail = [
    ...(body?.errorMessages ?? []),
    ...Object.entries(body?.errors ?? {}).map(([f, m]) => `${f}: ${m}`),
  ]
    .filter(Boolean)
    .join("; ");

  if (status === 401) {
    return new NonRetriableError(
      `${where}: Jira rejected the credential. Reconnect the Atlassian credential — retrying will not refresh a revoked grant.`,
    );
  }

  if (status === 403) {
    return new NonRetriableError(
      `${where}: Jira refused the request (403)${detail ? `: ${detail}` : ""}. The account may lack permission on this project, or the app may be missing a scope.`,
    );
  }

  if (status === 404) {
    return new NonRetriableError(
      `${where}: Jira returned 404${detail ? `: ${detail}` : ""}. Check the issue key or project key — Jira also answers 404 for a project the account cannot browse.`,
    );
  }

  if (status === 429) {
    const retryAfter = Number(headers.get("retry-after") ?? "30");
    return new RetryAfterError(
      `${where}: Jira rate limit hit.`,
      Number.isFinite(retryAfter) ? retryAfter : 30,
    );
  }

  if (status >= 500) {
    return new RetryAfterError(
      `${where}: Jira is unavailable (${status}).`,
      15,
    );
  }

  return new NonRetriableError(
    `${where}: Jira rejected the request (${status})${detail ? `: ${detail}` : ""}.`,
  );
}

/** One authenticated Jira Cloud REST call. */
export async function jiraFetch<T>(
  secret: CredentialSecret | undefined,
  request: JiraRequest,
): Promise<T> {
  const { cloudId, accessToken } = requireCloudId(secret, request.where);
  const version = request.apiVersion ?? "3";

  const url = new URL(
    `${ATLASSIAN_API}/ex/jira/${cloudId}/rest/api/${version}${request.path}`,
  );
  for (const [key, value] of Object.entries(request.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, {
    method: request.method ?? "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      ...(request.body ? { "Content-Type": "application/json" } : {}),
    },
    body: request.body ? JSON.stringify(request.body) : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    let parsed: JiraErrorBody | undefined;
    try {
      parsed = (await response.json()) as JiraErrorBody;
    } catch {
      parsed = undefined;
    }
    throw classify(response.status, response.headers, parsed, request.where);
  }

  // Transitions and some updates answer 204 with no body.
  if (response.status === 204) return undefined as T;

  const text = await response.text();
  if (text.length === 0) return undefined as T;
  return JSON.parse(text) as T;
}

// ---------------------------------------------------------------------------
// Atlassian Document Format
// ---------------------------------------------------------------------------

/**
 * Wrap plain text as a minimal ADF document.
 *
 * The v3 API will not accept a string where a document belongs, and its error
 * message does not mention ADF, so this is the difference between "it works"
 * and an afternoon of confusion. Blank lines separate paragraphs, which is how
 * people write when they think they are writing text.
 *
 * ADF has no empty-paragraph concept that renders reliably, so empty blocks
 * are dropped rather than emitted.
 */
export function textToAdf(text: string): {
  type: "doc";
  version: 1;
  content: unknown[];
} {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);

  const content = (paragraphs.length > 0 ? paragraphs : [""]).map((block) => ({
    type: "paragraph",
    // A single newline inside a block becomes a hard break, so a bulleted
    // list pasted into a description keeps its line structure.
    content: block
      .split("\n")
      .flatMap((line, index) =>
        index === 0
          ? [{ type: "text", text: line }]
          : [{ type: "hardBreak" }, { type: "text", text: line }],
      )
      .filter(
        (node) => node.type !== "text" || (node as { text: string }).text,
      ),
  }));

  return { type: "doc", version: 1, content };
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

export interface JiraTransition {
  id: string;
  name: string;
  to?: { name?: string; id?: string };
}

/**
 * Resolve a transition NAME to the id this issue's workflow uses.
 *
 * This is the reason the node takes a name at all. Transition ids are assigned
 * per workflow scheme, so "31" is Done in the project it was copied from and
 * something else — or nothing — anywhere else. Every published automation that
 * hardcodes an id is broken for everyone but its author, and the failure is
 * silent-ish: Jira answers 400 with a message about an invalid transition
 * rather than saying the id belongs to another project.
 *
 * Matching is case-insensitive and falls back to the destination STATUS name,
 * because people say "move it to Done" when the transition is called
 * "Finish Work" and the status it lands on is "Done".
 */
export function matchTransition(
  transitions: JiraTransition[],
  wanted: string,
): JiraTransition | undefined {
  const target = wanted.trim().toLowerCase();

  return (
    transitions.find((t) => t.name?.toLowerCase() === target) ??
    transitions.find((t) => t.to?.name?.toLowerCase() === target)
  );
}

/** The message a failed lookup should produce: it lists what IS available. */
export function describeAvailableTransitions(
  transitions: JiraTransition[],
): string {
  if (transitions.length === 0) {
    return "This issue has no available transitions — the account may lack permission to move it, or the workflow may have no outgoing step from its current status.";
  }
  return `Available from its current status: ${transitions
    .map((t) =>
      t.to?.name && t.to.name !== t.name
        ? `${t.name} (→ ${t.to.name})`
        : t.name,
    )
    .join(", ")}.`;
}
