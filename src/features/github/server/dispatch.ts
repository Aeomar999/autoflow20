import "server-only";
import { logger } from "@/lib/logger";
import { type GithubWebhookEvent, githubEventMatches } from "./webhook";

/**
 * Routing a GitHub delivery to the workflows that asked for it (AF-M10-18).
 *
 * GitHub posts to **one endpoint per app**, like Intuit and unlike the Stripe
 * and Google Form routes where the URL carries a per-workflow secret. So the
 * work runs backwards: verify the signature, read the repository out of the
 * verified payload, then find the published graphs whose GitHub trigger names
 * that repository.
 *
 * Matching on the repository from the **verified** body matters. Routing on
 * anything an unverified request could set would let anyone start any
 * workspace's workflows by posting a payload naming their repo.
 */

/** Loose shape of a published snapshot node; `graphSnapshot` is a Json column. */
type SnapshotNode = {
  id?: string;
  type?: string;
  disabled?: boolean;
  data?: Record<string, unknown>;
};

export interface GithubDispatchTarget {
  workflowId: string;
  organizationId: string;
  nodeId: string;
}

/** A cap on how many runs one delivery may start. */
export const MAX_TARGETS_PER_DELIVERY = 50;

const asStringArray = (value: unknown): string[] =>
  typeof value === "string"
    ? value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];

/**
 * Normalise a repository for comparison.
 *
 * The trigger's `repo` may be a pasted URL and GitHub sends `owner/name`, so
 * they are compared in the same lowercase `owner/name` form. GitHub treats
 * repository names case-insensitively, and a trigger typed as `Acme/Web` must
 * match a delivery that says `acme/web`.
 */
function normalizeRepo(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?github\.com\//, "")
    .replace(/\.git$/, "")
    .replace(/^\/+|\/+$/g, "");
}

/**
 * Every published GitHub trigger that wants this delivery.
 *
 * A workflow whose event filter excludes the delivery is not returned at all:
 * starting a run that immediately has nothing to act on burns quota and makes
 * the execution list unreadable.
 */
export function collectGithubTargets(args: {
  workflows: Array<{
    id: string;
    organizationId: string;
    activeVersion: { graphSnapshot: unknown } | null;
  }>;
  delivery: GithubWebhookEvent;
}): GithubDispatchTarget[] {
  const targets: GithubDispatchTarget[] = [];
  const deliveryRepo = normalizeRepo(args.delivery.repository);

  for (const workflow of args.workflows) {
    if (!workflow.activeVersion?.graphSnapshot) continue;

    let nodes: SnapshotNode[];
    try {
      const snapshot =
        typeof workflow.activeVersion.graphSnapshot === "string"
          ? (JSON.parse(workflow.activeVersion.graphSnapshot) as {
              nodes?: SnapshotNode[];
            })
          : (workflow.activeVersion.graphSnapshot as {
              nodes?: SnapshotNode[];
            });
      nodes = snapshot.nodes ?? [];
    } catch (error) {
      logger.error(
        `GitHub webhook: failed to parse graphSnapshot for workflow ${workflow.id}`,
        { error },
      );
      continue;
    }

    for (const node of nodes) {
      if (node?.type !== "GITHUB_TRIGGER") continue;
      if (!node.id || node.disabled === true) continue;

      // A trigger that names no repository would fire for every repository in
      // the whole GitHub app — including other tenants' — so it is skipped
      // rather than treated as a wildcard.
      const wanted = normalizeRepo(node.data?.repo);
      if (!wanted || wanted !== deliveryRepo) continue;

      const matches = githubEventMatches(args.delivery, {
        events: asStringArray(node.data?.events),
        actions: asStringArray(node.data?.actions),
      });
      if (!matches) continue;

      targets.push({
        workflowId: workflow.id,
        organizationId: workflow.organizationId,
        nodeId: node.id,
      });

      if (targets.length >= MAX_TARGETS_PER_DELIVERY) return targets;
    }
  }

  return targets;
}

/** The context a GitHub-triggered run starts with. */
export function githubTriggerContext(args: {
  delivery: GithubWebhookEvent;
  body: unknown;
}): Record<string, unknown> {
  return {
    github: {
      event: args.delivery.event,
      action: args.delivery.action,
      repository: args.delivery.repository,
      sender: args.delivery.sender,
      deliveryId: args.delivery.deliveryId,
      // The whole payload, because what matters differs per event: a push
      // wants commits, a pull_request wants the PR, a release wants the tag.
      payload: args.body,
    },
  };
}
