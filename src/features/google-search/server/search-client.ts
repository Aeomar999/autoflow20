import "server-only";
import { NonRetriableError, RetryAfterError } from "inngest";
import type { CredentialSecret } from "@/features/credentials/server/vault";
import { GOOGLE_MAPS_PAGE_SIZE, GOOGLE_SEARCH_PAGE_SIZE } from "../constants";

/**
 * Google Custom Search and Places (AF-M10-19).
 *
 * Both are metered per request, and both have a failure mode that reads as
 * something else:
 *
 * - Custom Search answers **429 for a daily quota that will not reset for
 *   hours**. Treating that as an ordinary rate limit means retrying every
 *   thirty seconds until the attempts run out, spending nothing but time and
 *   reporting the wrong cause. Quota exhaustion is permanent for this run.
 * - Places (New) requires a **field mask**, and the mask decides the price
 *   tier. Asking for contact details costs more than name and address, so the
 *   mask is built from what the node was configured to want rather than set to
 *   `*`, which would silently bill at the highest tier on every call.
 */

const CUSTOM_SEARCH_API = "https://www.googleapis.com/customsearch/v1";
const PLACES_API = "https://places.googleapis.com/v1/places:searchText";
const REQUEST_TIMEOUT_MS = 30_000;

export interface SearchResult {
  title: string;
  link: string;
  snippet: string;
  displayLink: string;
}

interface CustomSearchResponse {
  items?: Array<{
    title?: string;
    link?: string;
    snippet?: string;
    displayLink?: string;
  }>;
  searchInformation?: { totalResults?: string };
  error?: { message?: string; errors?: Array<{ reason?: string }> };
}

/**
 * One page of Custom Search results.
 *
 * `cx` comes from the credential, never from node config: it identifies the
 * search engine the key is billed against, and letting a workflow set it would
 * let one workflow point a colleague's key at a different engine.
 */
export async function customSearch(args: {
  secret: CredentialSecret | undefined;
  query: string;
  start: number;
  num: number;
  siteSearch?: string;
  language?: string;
  dateRestrict?: string;
  where: string;
}): Promise<{ results: SearchResult[]; totalResults: number }> {
  const apiKey = args.secret?.apiKey;
  const cx = args.secret?.cx;

  if (!apiKey) {
    throw new NonRetriableError(
      `${args.where}: no Google Custom Search credential is bound to this node.`,
    );
  }
  if (!cx) {
    throw new NonRetriableError(
      `${args.where}: the credential has no search-engine id (cx). Add it to the credential — a Custom Search key is meaningless without the engine it searches.`,
    );
  }

  const url = new URL(CUSTOM_SEARCH_API);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("cx", cx);
  url.searchParams.set("q", args.query);
  url.searchParams.set(
    "num",
    String(Math.min(args.num, GOOGLE_SEARCH_PAGE_SIZE)),
  );
  url.searchParams.set("start", String(args.start));
  if (args.siteSearch) url.searchParams.set("siteSearch", args.siteSearch);
  if (args.language) url.searchParams.set("lr", args.language);
  if (args.dateRestrict)
    url.searchParams.set("dateRestrict", args.dateRestrict);

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const body = (await response
    .json()
    .catch(() => ({}))) as CustomSearchResponse;

  if (!response.ok) {
    const reason = body.error?.errors?.[0]?.reason ?? "";
    const message = body.error?.message ?? "";

    if (response.status === 429 || reason.includes("Limit")) {
      // The important distinction. `rateLimitExceeded` clears in seconds;
      // `dailyLimitExceeded` and `quotaExceeded` do not clear until the
      // quota window rolls over, so retrying just spends attempts.
      if (
        reason === "rateLimitExceeded" ||
        reason === "userRateLimitExceeded"
      ) {
        return Promise.reject(
          new RetryAfterError(
            `${args.where}: Google Custom Search per-second rate limit hit.`,
            10,
          ),
        );
      }
      return Promise.reject(
        new NonRetriableError(
          `${args.where}: the Custom Search daily quota is exhausted (${reason || "quota"}). It does not reset for hours, so retrying will not help — raise the quota in Google Cloud, or search less per run. The free tier is 100 queries a day.`,
        ),
      );
    }

    if (response.status === 403) {
      return Promise.reject(
        new NonRetriableError(
          `${args.where}: Google refused the key${message ? `: ${message}` : ""}. Check the Custom Search JSON API is enabled on the project, and that the key's API restrictions allow it.`,
        ),
      );
    }

    if (response.status >= 500) {
      return Promise.reject(
        new RetryAfterError(
          `${args.where}: Google Custom Search is unavailable (${response.status}).`,
          15,
        ),
      );
    }

    return Promise.reject(
      new NonRetriableError(
        `${args.where}: Custom Search refused the request (${response.status})${message ? `: ${message}` : ""}.`,
      ),
    );
  }

  return {
    results: (body.items ?? []).map((item) => ({
      title: item.title ?? "",
      link: item.link ?? "",
      snippet: item.snippet ?? "",
      displayLink: item.displayLink ?? "",
    })),
    totalResults: Number(body.searchInformation?.totalResults ?? "0") || 0,
  };
}

export interface PlaceResult {
  name: string;
  address: string;
  rating: number | null;
  userRatingCount: number | null;
  types: string[];
  phone: string | null;
  website: string | null;
  googleMapsUri: string | null;
}

interface PlacesResponse {
  places?: Array<Record<string, unknown>>;
  nextPageToken?: string;
  error?: { message?: string; status?: string };
}

/**
 * The field mask, which is also the price list.
 *
 * Places (New) bills by SKU according to which fields are requested. Sending
 * `*` — the obvious shortcut — puts every call on the most expensive tier, so
 * the mask is assembled from what the node was actually asked for.
 */
function buildFieldMask(includeContactDetails: boolean): string {
  const essentials = [
    "places.displayName",
    "places.formattedAddress",
    "places.types",
    "places.googleMapsUri",
  ];
  const pro = ["places.rating", "places.userRatingCount"];
  const enterprise = [
    "places.nationalPhoneNumber",
    "places.websiteUri",
    "places.regularOpeningHours",
  ];

  return [
    ...essentials,
    ...pro,
    ...(includeContactDetails ? enterprise : []),
    "nextPageToken",
  ].join(",");
}

export async function placesTextSearch(args: {
  secret: CredentialSecret | undefined;
  query: string;
  pageSize: number;
  pageToken?: string;
  region?: string;
  includeContactDetails: boolean;
  where: string;
}): Promise<{ places: PlaceResult[]; nextPageToken?: string }> {
  const apiKey = args.secret?.apiKey;
  if (!apiKey) {
    throw new NonRetriableError(
      `${args.where}: no Google Maps credential is bound to this node.`,
    );
  }

  const response = await fetch(PLACES_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      // Mandatory. A request without it is a 400, and a `*` mask bills every
      // call at the highest tier.
      "X-Goog-FieldMask": buildFieldMask(args.includeContactDetails),
    },
    body: JSON.stringify({
      // The region is folded into the text query rather than sent as a
      // locationBias: bias takes coordinates, and what a workflow has is a
      // place name. Text search reads "dentists in Leeds" the way a person
      // would, which is the behaviour actually wanted here.
      textQuery: args.region ? `${args.query} in ${args.region}` : args.query,
      pageSize: Math.min(args.pageSize, GOOGLE_MAPS_PAGE_SIZE),
      ...(args.pageToken ? { pageToken: args.pageToken } : {}),
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const body = (await response.json().catch(() => ({}))) as PlacesResponse;

  if (!response.ok) {
    const message = body.error?.message ?? "";

    if (response.status === 429) {
      throw new RetryAfterError(`${args.where}: Places rate limit hit.`, 10);
    }
    if (response.status === 403) {
      throw new NonRetriableError(
        `${args.where}: Google refused the key${message ? `: ${message}` : ""}. Check the Places API (New) is enabled on the project — a key that works for Custom Search is not automatically allowed here.`,
      );
    }
    if (response.status >= 500) {
      throw new RetryAfterError(
        `${args.where}: Google Places is unavailable (${response.status}).`,
        15,
      );
    }
    throw new NonRetriableError(
      `${args.where}: Places refused the request (${response.status})${message ? `: ${message}` : ""}.`,
    );
  }

  const places = (body.places ?? []).map((place) => {
    const displayName = place.displayName as { text?: string } | undefined;
    return {
      name: displayName?.text ?? "",
      address: (place.formattedAddress as string) ?? "",
      rating: typeof place.rating === "number" ? place.rating : null,
      userRatingCount:
        typeof place.userRatingCount === "number"
          ? place.userRatingCount
          : null,
      types: Array.isArray(place.types) ? (place.types as string[]) : [],
      phone: (place.nationalPhoneNumber as string) ?? null,
      website: (place.websiteUri as string) ?? null,
      googleMapsUri: (place.googleMapsUri as string) ?? null,
    };
  });

  return { places, nextPageToken: body.nextPageToken };
}
