import "server-only";
import { NonRetriableError, RetryAfterError } from "inngest";
import type { CredentialSecret } from "@/features/credentials/server/vault";

/**
 * The one Apollo client (AF-M10-19).
 *
 * Two things worth knowing:
 *
 * 1. **Apollo bills credits per successful match**, not per request, and it
 *    enforces per-minute, per-hour and per-day limits at the same time. A 429
 *    can therefore mean "wait twenty seconds" or "wait until tomorrow", and
 *    the headers are the only way to tell — retrying a daily exhaustion every
 *    thirty seconds just burns the retry budget to learn nothing.
 * 2. **A miss is a 200.** Apollo answers a no-match with `{"person": null}`,
 *    not a 404, so a client that only checks the status treats "we could not
 *    find this person" as a successful enrichment and hands null fields
 *    downstream.
 */

const APOLLO_API = "https://api.apollo.io/api/v1";
const REQUEST_TIMEOUT_MS = 30_000;

export interface ApolloPerson {
  id?: string;
  first_name?: string;
  last_name?: string;
  name?: string;
  title?: string;
  email?: string;
  linkedin_url?: string;
  city?: string;
  country?: string;
  organization?: {
    name?: string;
    website_url?: string;
    primary_domain?: string;
    industry?: string;
    estimated_num_employees?: number;
  };
}

export interface ApolloOrganization {
  id?: string;
  name?: string;
  website_url?: string;
  primary_domain?: string;
  industry?: string;
  estimated_num_employees?: number;
  annual_revenue?: number;
  linkedin_url?: string;
  city?: string;
  country?: string;
  short_description?: string;
}

/**
 * Turn a 429 into a wait the engine can act on.
 *
 * Apollo returns its window counters as headers. The minute window is the one
 * a retry can plausibly clear; if the *daily* allowance is gone, retrying is
 * pointless and the run should fail with a message that says so rather than
 * burn attempts.
 */
function classifyRateLimit(headers: Headers, where: string): Error {
  const dayRemaining = Number(
    headers.get("x-24-hour-requests-left") ??
      headers.get("x-rate-limit-24-hour-left") ??
      "1",
  );

  if (Number.isFinite(dayRemaining) && dayRemaining <= 0) {
    return new NonRetriableError(
      `${where}: Apollo's daily request allowance is exhausted. Retrying will not help until the window resets — reduce how many records this workflow enriches per run, or raise the plan limit.`,
    );
  }

  const retryAfter = Number(headers.get("retry-after") ?? "60");
  return new RetryAfterError(
    `${where}: Apollo rate limit hit (per-minute window).`,
    Number.isFinite(retryAfter) ? retryAfter : 60,
  );
}

export async function apolloFetch<T>(
  secret: CredentialSecret | undefined,
  args: {
    path: string;
    body: Record<string, unknown>;
    where: string;
  },
): Promise<T> {
  const apiKey = secret?.apiKey;
  if (!apiKey) {
    throw new NonRetriableError(
      `${args.where}: no Apollo credential is bound to this node. Connect an Apollo credential.`,
    );
  }

  const response = await fetch(`${APOLLO_API}${args.path}`, {
    method: "POST",
    headers: {
      // Apollo's current auth. Older examples put `api_key` in the body, which
      // still works on some endpoints and silently 401s on others.
      "x-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(args.body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (response.status === 429) {
    throw classifyRateLimit(response.headers, args.where);
  }

  if (response.status === 401 || response.status === 403) {
    throw new NonRetriableError(
      `${args.where}: Apollo rejected the API key. Check that it is a master key with API access — Apollo issues keys that can read the app but not the API.`,
    );
  }

  if (response.status === 422) {
    throw new NonRetriableError(
      `${args.where}: Apollo rejected the query as unusable. A person match needs an email, or a name together with a company domain.`,
    );
  }

  if (response.status >= 500) {
    throw new RetryAfterError(
      `${args.where}: Apollo is unavailable (${response.status}).`,
      15,
    );
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new NonRetriableError(
      `${args.where}: Apollo refused the request (${response.status})${
        text ? `: ${text.slice(0, 200)}` : ""
      }.`,
    );
  }

  return (await response.json()) as T;
}

/** Flatten a matched person into the fields a workflow actually uses. */
export function shapePerson(person: ApolloPerson) {
  return {
    id: person.id ?? null,
    firstName: person.first_name ?? null,
    lastName: person.last_name ?? null,
    name:
      person.name ??
      [person.first_name, person.last_name].filter(Boolean).join(" ") ??
      null,
    title: person.title ?? null,
    // Absent unless the request asked for it — and asking costs more.
    email: person.email ?? null,
    linkedinUrl: person.linkedin_url ?? null,
    city: person.city ?? null,
    country: person.country ?? null,
    companyName: person.organization?.name ?? null,
    companyDomain: person.organization?.primary_domain ?? null,
    companyWebsite: person.organization?.website_url ?? null,
    companyIndustry: person.organization?.industry ?? null,
    companyEmployees: person.organization?.estimated_num_employees ?? null,
  };
}

export function shapeOrganization(org: ApolloOrganization) {
  return {
    id: org.id ?? null,
    name: org.name ?? null,
    domain: org.primary_domain ?? null,
    website: org.website_url ?? null,
    industry: org.industry ?? null,
    employees: org.estimated_num_employees ?? null,
    annualRevenue: org.annual_revenue ?? null,
    linkedinUrl: org.linkedin_url ?? null,
    city: org.city ?? null,
    country: org.country ?? null,
    description: org.short_description ?? null,
  };
}
