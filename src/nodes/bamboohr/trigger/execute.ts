import "server-only";
import type { NodeRun } from "@/nodes/types";

/**
 * The BambooHR trigger contributes the employee the sweep already fetched.
 *
 * Like every polling trigger, this does no fetching: by the time a run reaches
 * this node the item is already in its initial data.
 */
export const execute: NodeRun<Record<string, unknown>> = async ({
  context,
  step,
}) => step.run("bamboohr-trigger", async () => context);
