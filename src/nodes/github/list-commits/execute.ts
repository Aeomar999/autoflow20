import "server-only";
import { NonRetriableError } from "inngest";
import {
  githubPaginate,
  parseRepo,
} from "@/features/github/server/github-client";
import type { NodeRun } from "@/nodes/types";

type GithubListCommitsData = {
  variableName?: string;
  credentialId?: string;
  repo?: string;
  ref?: string;
  since?: string;
  path?: string;
  limit?: number;
};

interface GithubCommit {
  sha: string;
  html_url: string;
  commit?: {
    message?: string;
    author?: { name?: string; email?: string; date?: string };
  };
  author?: { login?: string } | null;
}

export const execute: NodeRun<GithubListCommitsData> = async ({
  data,
  context,
  resolve,
  step,
  credentials,
}) =>
  step.run("github-list-commits", async () => {
    if (!data.variableName) {
      throw new NonRetriableError(
        "GitHub List Commits node: Variable name not configured",
      );
    }
    if (!data.repo) {
      throw new NonRetriableError(
        "GitHub List Commits node: Repository not configured",
      );
    }

    const where = "GitHub List Commits node";
    const { owner, repo } = parseRepo(resolve(data.repo), where);

    const { items, truncated } = await githubPaginate<GithubCommit>(
      credentials?.credentialId,
      {
        path: `/repos/${owner}/${repo}/commits`,
        query: {
          ...(data.ref ? { sha: resolve(data.ref).trim() } : {}),
          ...(data.since ? { since: resolve(data.since).trim() } : {}),
          ...(data.path ? { path: resolve(data.path).trim() } : {}),
        },
        limit: data.limit ?? 100,
        where,
      },
    );

    return {
      ...context,
      [data.variableName]: {
        commits: items.map((commit) => ({
          sha: commit.sha,
          shortSha: commit.sha.slice(0, 7),
          url: commit.html_url,
          // The first line only: a commit body can be paragraphs, and a
          // changelog wants the subject.
          subject: (commit.commit?.message ?? "").split("\n")[0],
          message: commit.commit?.message ?? "",
          authorName: commit.commit?.author?.name ?? null,
          // The GitHub account, which is absent when the committer email is
          // not linked to one. Distinct from the git author name.
          authorLogin: commit.author?.login ?? null,
          date: commit.commit?.author?.date ?? null,
        })),
        count: items.length,
        truncated,
      },
    };
  });
