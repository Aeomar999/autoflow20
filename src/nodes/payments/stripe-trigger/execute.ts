import "server-only";
import { stripeTriggerChannel } from "@/inngest/channels/stripe-trigger";
import type { NodeRun } from "@/nodes/types";

export const execute: NodeRun = async ({ nodeId, context, step, publish }) => {
  await publish(
    stripeTriggerChannel().status({
      nodeId,
      status: "loading",
    }),
  );

  const result = await step.run("stripe-trigger", async () => context);

  await publish(
    stripeTriggerChannel().status({
      nodeId,
      status: "success",
    }),
  );

  return result;
};
