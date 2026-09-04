import "server-only";
import { NonRetriableError } from "inngest";
import {
  githubFetch,
  githubPaginate,
  parseRepo,
} from "@/features/github/server/github-client";
import type { NodeRun } from "@/nodes/types";

type GithubCreatePrData = {
  variableName?: string;
  credentialId?: string;
  repo?: string;
  title?: string;
  head?: string;
  base?: string;
  body?: string;
  draft?: boolean;
};

interface GithubPr {
  number: number;
  html_url: string;
  state: string;
  draft?: boolean;
  head?: { ref?: string };
  base?: { ref?: string };
}

export const execute: NodeRun<GithubCreatePrData> = async ({
  data,
  context,
  resolve,
  step,
  credentials,
}) =>
  step.run("github-create-pr", async () => {
    if (!data.variableName) {
      throw new NonRetriableError(
        "GitHub Create PR node: Variable name not configured",
      );
    }
    if (!data.repo) {
      throw new NonRetriableError(
        "GitHub Create PR node: Repository not configured",
      );
    }
    if (!data.title) {
      throw new NonRetriableError(
        "GitHub Create PR node: Title not configured",
      );
    }
    if (!data.head) {
      throw new NonRetriableError(
        "GitHub Create PR node: Head branch not configured",
      );
    }

    const where = "GitHub Create PR node";
    const secret = credentials?.credentialId;
    const { owner, repo } = parseRepo(resolve(data.repo), where);
    const head = resolve(data.head).trim();

    // A blank base means the repository's default branch, which is what people
    // mean and is not always "main".
    let base = data.base ? resolve(data.base).trim() : "";
    if (!base) {
      const info = await githubFetch<{ default_branch?: string }>(secret, {
        path: `/repos/${owner}/${repo}`,
        where,
      });
      base = info.default_branch ?? "main";
    }

    try {
      const pr = await githubFetch<GithubPr>(secret, {
        path: `/repos/${owner}/${repo}/pulls`,
        method: "POST",
        body: {
          title: resolve(data.title),
          head,
          base,
          ...(data.body ? { body: resolve(data.body) } : {}),
          draft: data.draft ?? false,
        },
        where,
      });

      return {
        ...context,
        [data.variableName]: {
          number: pr.number,
          url: pr.html_url,
          state: pr.state,
          head,
          base,
          created: true,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "";

      // GitHub rejects a duplicate PR with 422 "A pull request already exists".
      // That is the goal state for a re-run, so the existing PR is returned
      // instead — which also makes a retried step idempotent.
      if (!message.includes("pull request already exists")) {
        // The other common 422 is "No commits between base and head", which
        // means the branch has nothing to merge. Say so plainly: the raw
        // message reads like an API fault rather than an empty branch.
        if (message.includes("No commits between")) {
          throw new NonRetriableError(
            `${where}: there are no commits on "${head}" that are not already on "${base}", so there is nothing to open a pull request for.`,
          );
        }
        throw error;
      }

      const { items } = await githubPaginate<GithubPr>(secret, {
        path: `/repos/${owner}/${repo}/pulls`,
        query: { state: "open", head: `${owner}:${head}`, base },
        limit: 100,
        where,
      });

      const existing = items[0];
      if (!existing) {
        throw new NonRetriableError(
          `${where}: GitHub reports a pull request already exists for "${head}" into "${base}", but none is visible to this token.`,
        );
      }

      return {
        ...context,
        [data.variableName]: {
          number: existing.number,
          url: existing.html_url,
          state: existing.state,
          head,
          base,
          // Distinguished so a downstream step can comment or notify only on a
          // genuinely new pull request.
          created: false,
        },
      };
    }
  });
