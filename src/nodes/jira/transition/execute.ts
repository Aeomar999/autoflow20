import "server-only";
import { NonRetriableError } from "inngest";
import {
  describeAvailableTransitions,
  type JiraTransition,
  jiraFetch,
  matchTransition,
  textToAdf,
} from "@/features/jira/server/jira-client";
import type { NodeRun } from "@/nodes/types";

type JiraTransitionData = {
  variableName?: string;
  credentialId?: string;
  issueKey?: string;
  transition?: string;
  comment?: string;
};

export const execute: NodeRun<JiraTransitionData> = async ({
  data,
  context,
  resolve,
  step,
  credentials,
}) =>
  step.run("jira-transition", async () => {
    if (!data.variableName) {
      throw new NonRetriableError(
        "Jira Transition node: Variable name not configured",
      );
    }
    if (!data.issueKey) {
      throw new NonRetriableError(
        "Jira Transition node: Issue key not configured",
      );
    }
    if (!data.transition) {
      throw new NonRetriableError(
        "Jira Transition node: Transition name not configured",
      );
    }

    const where = "Jira Transition node";
    const secret = credentials?.credentialId;
    const issueKey = resolve(data.issueKey).trim().toUpperCase();
    const wanted = resolve(data.transition).trim();

    // Ask THIS issue what it can do. Transitions depend on the project's
    // workflow scheme and on the issue's current status, so the answer is
    // specific to this issue at this moment — which is exactly why an id
    // baked into a template cannot be right in general.
    const available = await jiraFetch<{ transitions?: JiraTransition[] }>(
      secret,
      { path: `/issue/${issueKey}/transitions`, where },
    );
    const transitions = available.transitions ?? [];

    const match = matchTransition(transitions, wanted);
    if (!match) {
      // Listing what IS available turns a dead end into a fix: usually the
      // issue is already in the target status, or the workflow calls the step
      // something else.
      throw new NonRetriableError(
        `${where}: "${wanted}" is not a transition available on ${issueKey}. ${describeAvailableTransitions(transitions)}`,
      );
    }

    await jiraFetch(secret, {
      path: `/issue/${issueKey}/transitions`,
      method: "POST",
      body: {
        transition: { id: match.id },
        ...(data.comment
          ? {
              update: {
                comment: [{ add: { body: textToAdf(resolve(data.comment)) } }],
              },
            }
          : {}),
      },
      where,
    });

    const siteUrl = secret?.siteUrl;

    return {
      ...context,
      [data.variableName]: {
        issueKey,
        transitionApplied: match.name,
        // The status it landed on, which is what a later step wants to read.
        status: match.to?.name ?? null,
        url: siteUrl ? `${siteUrl}/browse/${issueKey}` : null,
      },
    };
  });
