import "server-only";
import type { NodeRun } from "@/nodes/types";

/**
 * The Telegram trigger contributes the update the route already verified.
 *
 * Reaching this code means the delivery carried the workflow's secret token
 * and passed the size and shape checks; the update is already in the run's
 * initial data.
 */
export const execute: NodeRun<Record<string, unknown>> = async ({
  context,
  step,
}) => step.run("telegram-trigger", async () => context);
