import "server-only";
import { NonRetriableError } from "inngest";
import { jiraFetch, textToAdf } from "@/features/jira/server/jira-client";
import type { NodeRun } from "@/nodes/types";

type JiraCreateIssueData = {
  variableName?: string;
  credentialId?: string;
  projectKey?: string;
  issueType?: string;
  summary?: string;
  description?: string;
  labels?: string;
  priority?: string;
  assigneeAccountId?: string;
};

interface JiraCreateMeta {
  projects?: Array<{
    key?: string;
    issuetypes?: Array<{ id?: string; name?: string }>;
  }>;
}

export const execute: NodeRun<JiraCreateIssueData> = async ({
  data,
  context,
  resolve,
  step,
  credentials,
}) =>
  step.run("jira-create-issue", async () => {
    if (!data.variableName) {
      throw new NonRetriableError(
        "Jira Create Issue node: Variable name not configured",
      );
    }
    if (!data.projectKey) {
      throw new NonRetriableError(
        "Jira Create Issue node: Project key not configured",
      );
    }
    if (!data.summary) {
      throw new NonRetriableError(
        "Jira Create Issue node: Summary not configured",
      );
    }

    const where = "Jira Create Issue node";
    const secret = credentials?.credentialId;
    const projectKey = resolve(data.projectKey).trim().toUpperCase();
    const wantedType = (
      data.issueType ? resolve(data.issueType) : "Task"
    ).trim();

    // Issue type ids are per project, so the NAME is resolved here for the
    // same reason transitions are: an id copied from another project either
    // fails or, worse, names a different type.
    const meta = await jiraFetch<JiraCreateMeta>(secret, {
      path: "/issue/createmeta",
      query: {
        projectKeys: projectKey,
        expand: "projects.issuetypes",
      },
      where,
    });

    const project = meta.projects?.find(
      (p) => p.key?.toUpperCase() === projectKey,
    );
    if (!project) {
      throw new NonRetriableError(
        `${where}: project "${projectKey}" is not visible to this connection. Check the key, and that the authorising account can create issues in it.`,
      );
    }

    const types = project.issuetypes ?? [];
    const issueType = types.find(
      (t) => t.name?.toLowerCase() === wantedType.toLowerCase(),
    );
    if (!issueType?.id) {
      throw new NonRetriableError(
        `${where}: "${wantedType}" is not an issue type in ${projectKey}. Available: ${
          types
            .map((t) => t.name)
            .filter(Boolean)
            .join(", ") || "none"
        }.`,
      );
    }

    const labels = data.labels
      ? resolve(data.labels)
          .split(",")
          .map((l) => l.trim().replace(/\s+/g, "-"))
          .filter(Boolean)
      : [];

    const created = await jiraFetch<{ id?: string; key?: string }>(secret, {
      path: "/issue",
      method: "POST",
      body: {
        fields: {
          project: { key: projectKey },
          issuetype: { id: issueType.id },
          summary: resolve(data.summary).slice(0, 255),
          // The v3 API takes a document, not a string. A plain string is
          // rejected with a message that never mentions ADF.
          ...(data.description
            ? { description: textToAdf(resolve(data.description)) }
            : {}),
          ...(labels.length > 0 ? { labels } : {}),
          ...(data.priority
            ? { priority: { name: resolve(data.priority).trim() } }
            : {}),
          ...(data.assigneeAccountId
            ? { assignee: { id: resolve(data.assigneeAccountId).trim() } }
            : {}),
        },
      },
      where,
    });

    if (!created?.key) {
      throw new NonRetriableError(
        `${where}: Jira accepted the request but returned no issue key.`,
      );
    }

    const siteUrl = secret?.siteUrl;

    return {
      ...context,
      [data.variableName]: {
        id: created.id ?? null,
        key: created.key,
        projectKey,
        issueType: issueType.name ?? wantedType,
        // Built from the site URL stored at connect time: the API base
        // (api.atlassian.com) is not a URL a person can open.
        url: siteUrl ? `${siteUrl}/browse/${created.key}` : null,
      },
    };
  });
