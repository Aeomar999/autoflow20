import "server-only";
import type { NodeRun } from "@/nodes/types";

/**
 * The WAHA trigger contributes the message the route already verified.
 *
 * Reaching this code means the delivery carried the workflow's secret, was
 * within the size cap, and was not one of the bot's own outbound messages.
 */
export const execute: NodeRun<Record<string, unknown>> = async ({
  context,
  step,
}) => step.run("waha-trigger", async () => context);
