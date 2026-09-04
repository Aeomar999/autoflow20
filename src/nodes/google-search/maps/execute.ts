import "server-only";
import { NonRetriableError } from "inngest";
import {
  GOOGLE_MAPS_MAX_RESULTS,
  GOOGLE_MAPS_PAGE_SIZE,
} from "@/features/google-search/constants";
import {
  type PlaceResult,
  placesTextSearch,
} from "@/features/google-search/server/search-client";
import type { NodeRun } from "@/nodes/types";

type GoogleMapsData = {
  variableName?: string;
  credentialId?: string;
  query?: string;
  limit?: number;
  region?: string;
  includeContactDetails?: boolean;
};

export const execute: NodeRun<GoogleMapsData> = async ({
  data,
  context,
  resolve,
  step,
  credentials,
}) =>
  step.run("google-maps-search", async () => {
    if (!data.variableName) {
      throw new NonRetriableError(
        "Google Maps node: Variable name not configured",
      );
    }
    if (!data.query) {
      throw new NonRetriableError("Google Maps node: Query not configured");
    }

    const where = "Google Maps node";
    const secret = credentials?.credentialId;
    const query = resolve(data.query).trim();

    if (query.length === 0) {
      throw new NonRetriableError(
        `${where}: the query expression resolved to nothing. Every Places request is billed, so an empty search is refused rather than sent.`,
      );
    }

    const limit = Math.min(data.limit ?? 20, GOOGLE_MAPS_MAX_RESULTS);
    const places: PlaceResult[] = [];
    let pageToken: string | undefined;

    // Places serves at most 60 across three pages, and each page is a
    // separately billed request. The schema cap and this loop agree on that
    // ceiling rather than paging until Google says stop.
    const maxPages = Math.ceil(GOOGLE_MAPS_MAX_RESULTS / GOOGLE_MAPS_PAGE_SIZE);

    for (let page = 0; page < maxPages && places.length < limit; page += 1) {
      const result = await placesTextSearch({
        secret,
        query,
        pageSize: Math.min(limit - places.length, GOOGLE_MAPS_PAGE_SIZE),
        pageToken,
        region: data.region ? resolve(data.region).trim() : undefined,
        includeContactDetails: data.includeContactDetails ?? false,
        where,
      });

      places.push(...result.places);
      pageToken = result.nextPageToken;
      if (!pageToken || result.places.length === 0) break;
    }

    const trimmed = places.slice(0, limit);

    return {
      ...context,
      [data.variableName]: {
        query,
        places: trimmed,
        count: trimmed.length,
        // True when Google had more to give and the cap stopped us, so a
        // partial result never reads as the complete list of local businesses.
        truncated: Boolean(pageToken) && trimmed.length >= limit,
        // Off unless asked for: phone and website are billed on a higher SKU
        // than name and address.
        contactDetailsRequested: data.includeContactDetails ?? false,
      },
    };
  });
