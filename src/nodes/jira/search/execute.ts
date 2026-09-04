import "server-only";
import { NonRetriableError } from "inngest";
import { jiraFetch } from "@/features/jira/server/jira-client";
import type { NodeRun } from "@/nodes/types";

type JiraSearchData = {
  variableName?: string;
  credentialId?: string;
  jql?: string;
  limit?: number;
};

interface JiraIssue {
  id?: string;
  key?: string;
  fields?: {
    summary?: string;
    status?: { name?: string };
    assignee?: { displayName?: string; accountId?: string } | null;
    priority?: { name?: string };
    labels?: string[];
    created?: string;
    updated?: string;
  };
}

/** Jira caps a search page at 100 regardless of what is asked for. */
const PAGE_SIZE = 100;
const MAX_PAGES = 10;

export const execute: NodeRun<JiraSearchData> = async ({
  data,
  context,
  resolve,
  step,
  credentials,
}) =>
  step.run("jira-search", async () => {
    if (!data.variableName) {
      throw new NonRetriableError(
        "Jira Search node: Variable name not configured",
      );
    }
    if (!data.jql) {
      throw new NonRetriableError("Jira Search node: JQL not configured");
    }

    const where = "Jira Search node";
    const secret = credentials?.credentialId;
    const jql = resolve(data.jql).trim();
    const limit = data.limit ?? 100;

    const issues: JiraIssue[] = [];
    let nextPageToken: string | undefined;
    let pages = 0;

    while (pages < MAX_PAGES && issues.length < limit) {
      const page = await jiraFetch<{
        issues?: JiraIssue[];
        nextPageToken?: string;
        isLast?: boolean;
      }>(secret, {
        path: "/search/jql",
        method: "POST",
        body: {
          jql,
          maxResults: Math.min(limit - issues.length, PAGE_SIZE),
          // Asking for named fields rather than everything: the default
          // response carries every custom field on the issue, which for a
          // mature Jira site is tens of kilobytes per row.
          fields: [
            "summary",
            "status",
            "assignee",
            "priority",
            "labels",
            "created",
            "updated",
          ],
          ...(nextPageToken ? { nextPageToken } : {}),
        },
        where,
      });

      issues.push(...(page.issues ?? []));
      pages += 1;

      nextPageToken = page.nextPageToken;
      if (!nextPageToken || page.isLast) break;
    }

    const siteUrl = secret?.siteUrl;
    const rows = issues.slice(0, limit);

    return {
      ...context,
      [data.variableName]: {
        jql,
        issues: rows.map((issue) => ({
          id: issue.id ?? null,
          key: issue.key ?? null,
          summary: issue.fields?.summary ?? "",
          status: issue.fields?.status?.name ?? null,
          assignee: issue.fields?.assignee?.displayName ?? null,
          assigneeAccountId: issue.fields?.assignee?.accountId ?? null,
          priority: issue.fields?.priority?.name ?? null,
          labels: issue.fields?.labels ?? [],
          created: issue.fields?.created ?? null,
          updated: issue.fields?.updated ?? null,
          url: siteUrl && issue.key ? `${siteUrl}/browse/${issue.key}` : null,
        })),
        count: rows.length,
        truncated: Boolean(nextPageToken) || issues.length > limit,
      },
    };
  });
