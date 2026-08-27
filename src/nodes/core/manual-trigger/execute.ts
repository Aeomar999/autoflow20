import "server-only";
import { manualTriggerChannel } from "@/inngest/channels/manual-trigger";
import type { NodeRun } from "@/nodes/types";

export const execute: NodeRun = async ({ nodeId, context, step, publish }) => {
  await publish(
    manualTriggerChannel().status({
      nodeId,
      status: "loading",
    }),
  );

  const result = await step.run("manual-trigger", async () => context);

  await publish(
    manualTriggerChannel().status({
      nodeId,
      status: "success",
    }),
  );

  return result;
};
