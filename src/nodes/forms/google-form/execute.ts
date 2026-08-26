import "server-only";
import { googleFormTriggerChannel } from "@/inngest/channels/google-form-trigger";
import type { NodeRun } from "@/nodes/types";

export const execute: NodeRun = async ({ nodeId, context, step, publish }) => {
  await publish(
    googleFormTriggerChannel().status({
      nodeId,
      status: "loading",
    }),
  );

  const result = await step.run("google-form-trigger", async () => context);

  await publish(
    googleFormTriggerChannel().status({
      nodeId,
      status: "success",
    }),
  );

  return result;
};
