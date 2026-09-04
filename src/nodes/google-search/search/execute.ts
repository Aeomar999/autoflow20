import "server-only";
import { NonRetriableError } from "inngest";
import {
  GOOGLE_SEARCH_MAX_RESULTS,
  GOOGLE_SEARCH_PAGE_SIZE,
} from "@/features/google-search/constants";
import {
  customSearch,
  type SearchResult,
} from "@/features/google-search/server/search-client";
import type { NodeRun } from "@/nodes/types";

type GoogleSearchData = {
  variableName?: string;
  credentialId?: string;
  query?: string;
  limit?: number;
  siteSearch?: string;
  language?: string;
  dateRestrict?: string;
};

export const execute: NodeRun<GoogleSearchData> = async ({
  data,
  context,
  resolve,
  step,
  credentials,
}) =>
  step.run("google-search", async () => {
    if (!data.variableName) {
      throw new NonRetriableError(
        "Google Search node: Variable name not configured",
      );
    }
    if (!data.query) {
      throw new NonRetriableError("Google Search node: Query not configured");
    }

    const where = "Google Search node";
    const secret = credentials?.credentialId;
    const query = resolve(data.query).trim();

    if (query.length === 0) {
      // A blank query still costs a billed request and returns nothing useful.
      throw new NonRetriableError(
        `${where}: the query expression resolved to nothing. Every Custom Search request is metered, so an empty search is refused rather than sent.`,
      );
    }

    const limit = Math.min(data.limit ?? 10, GOOGLE_SEARCH_MAX_RESULTS);
    const results: SearchResult[] = [];
    let totalResults = 0;

    // Each iteration is one billed query. The loop is bounded by `limit`,
    // which the schema caps at Google's own 100-result ceiling.
    while (results.length < limit) {
      const page = await customSearch({
        secret,
        query,
        // Custom Search's `start` is 1-based.
        start: results.length + 1,
        num: Math.min(limit - results.length, GOOGLE_SEARCH_PAGE_SIZE),
        siteSearch: data.siteSearch
          ? resolve(data.siteSearch).trim()
          : undefined,
        language: data.language?.trim() || undefined,
        dateRestrict: data.dateRestrict?.trim() || undefined,
        where,
      });

      totalResults = page.totalResults;
      results.push(...page.results);

      // A short page means Google has nothing more, whatever the total says —
      // its `totalResults` is an estimate and routinely overstates.
      if (page.results.length < GOOGLE_SEARCH_PAGE_SIZE) break;
    }

    const trimmed = results.slice(0, limit);

    return {
      ...context,
      [data.variableName]: {
        query,
        results: trimmed,
        count: trimmed.length,
        // Google's own estimate, which is usually far larger than what it will
        // actually serve — it will not page past 100.
        estimatedTotal: totalResults,
        // How many billed queries this node just spent.
        queriesUsed: Math.ceil(trimmed.length / GOOGLE_SEARCH_PAGE_SIZE) || 1,
      },
    };
  });
