import "server-only";
import { manualTriggerChannel } from "@/inngest/channels/manual-trigger";
import type { NodeRun } from "@/nodes/types";

/**
 * Schedule trigger stub: passes through context unchanged.
 * Full cron/schedule receiver lands with M4.
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
