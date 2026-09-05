import "server-only";
import type { NodeRun } from "@/nodes/types";

type GithubTriggerData = Record<string, unknown>;

/**
 * The GitHub trigger contributes the delivery the route already verified.
 *
 * Like every trigger, this does not poll or listen: the webhook route
 * authenticates the delivery, decides which workflows it matches, and seeds
 * the run context. Reaching this code means the run is already under way.
 */
export const execute: NodeRun<GithubTriggerData> = async ({ context, step }) =>
  step.run("github-trigger", async () => context);
