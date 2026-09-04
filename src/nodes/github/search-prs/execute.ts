import "server-only";
import { NonRetriableError } from "inngest";
import { githubFetch, parseRepo } from "@/features/github/server/github-client";
import type { NodeRun } from "@/nodes/types";

type GithubSearchPrsData = {
  variableName?: string;
  credentialId?: string;
  repo?: string;
  query?: string;
  state?: "open" | "closed" | "all";
  limit?: number;
};

interface GithubSearchItem {
  number: number;
  title: string;
  html_url: string;
  state: string;
  draft?: boolean;
  user?: { login?: string } | null;
  created_at?: string;
  updated_at?: string;
  labels?: Array<{ name?: string }>;
  repository_url?: string;
}

/** GitHub's search endpoint caps a page at 100 and the whole result set at 1000. */
const SEARCH_PAGE_SIZE = 100;
const SEARCH_RESULT_CEILING = 1000;

export const execute: NodeRun<GithubSearchPrsData> = async ({
  data,
  context,
  resolve,
  step,
  credentials,
}) =>
  step.run("github-search-prs", async () => {
    if (!data.variableName) {
      throw new NonRetriableError(
        "GitHub Search PRs node: Variable name not configured",
      );
    }

    const where = "GitHub Search PRs node";
    const secret = credentials?.credentialId;

    // `is:pr` is not optional: the search endpoint covers issues and pull
    // requests together, and without it a query for "open" returns issues too.
    const parts = ["is:pr"];
    if (data.state && data.state !== "all") parts.push(`is:${data.state}`);
    if (data.repo) {
      const { owner, repo } = parseRepo(resolve(data.repo), where);
      parts.push(`repo:${owner}/${repo}`);
    }
    if (data.query) parts.push(resolve(data.query).trim());

    const q = parts.filter(Boolean).join(" ");
    const limit = Math.min(data.limit ?? 100, SEARCH_RESULT_CEILING);

    const items: GithubSearchItem[] = [];
    let page = 1;
    let total = 0;

    while (items.length < limit) {
      const result = await githubFetch<{
        total_count?: number;
        incomplete_results?: boolean;
        items?: GithubSearchItem[];
      }>(secret, {
        path: "/search/issues",
        query: {
          q,
          per_page: Math.min(limit - items.length, SEARCH_PAGE_SIZE),
          page,
          sort: "updated",
          order: "desc",
        },
        where,
      });

      total = result.total_count ?? 0;
      const batch = result.items ?? [];
      items.push(...batch);

      if (batch.length < SEARCH_PAGE_SIZE) break;
      page += 1;
      // GitHub refuses to page past 1000 results and answers 422 if asked.
      if (page * SEARCH_PAGE_SIZE > SEARCH_RESULT_CEILING) break;
    }

    return {
      ...context,
      [data.variableName]: {
        query: q,
        pullRequests: items.slice(0, limit).map((item) => ({
          number: item.number,
          title: item.title,
          url: item.html_url,
          state: item.state,
          isDraft: item.draft ?? false,
          author: item.user?.login ?? null,
          createdAt: item.created_at ?? null,
          updatedAt: item.updated_at ?? null,
          labels: (item.labels ?? [])
            .map((l) => l.name)
            .filter((n): n is string => typeof n === "string"),
          repo: item.repository_url?.replace(
            "https://api.github.com/repos/",
            "",
          ),
        })),
        count: Math.min(items.length, limit),
        // GitHub's own total, which can exceed what the ceiling let us fetch.
        totalMatching: total,
        truncated: total > Math.min(items.length, limit),
      },
    };
  });
