import "server-only";
import { manualTriggerChannel } from "@/inngest/channels/manual-trigger";
import type { NodeRun } from "@/nodes/types";

/**
 * Schedule trigger execution.
 * The central Inngest cron injects the scheduled time into context.
 */
export const execute: NodeRun = async ({ nodeId, context, step, publish }) => {
  await publish(
    manualTriggerChannel().status({
      nodeId,
      status: "loading",
    }),
  );

  const result = await step.run("schedule-trigger", async () => context);

  await publish(
    manualTriggerChannel().status({
      nodeId,
      status: "success",
    }),
  );

  return result;
};
