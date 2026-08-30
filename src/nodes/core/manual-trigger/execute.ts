import "server-only";
import { manualTriggerChannel } from "@/inngest/channels/manual-trigger";
import type { NodeRun } from "@/nodes/types";

export const execute: NodeRun<{ payload?: string }> = async ({
  nodeId,
  data,
  context,
  step,
  publish,
}) => {
  await publish(
    manualTriggerChannel().status({
      nodeId,
      status: "loading",
    }),
  );

  let initialPayload = context;
  if (data?.payload) {
    try {
      const parsed = JSON.parse(data.payload);
      initialPayload = {
        ...context,
        trigger: parsed,
        ...(typeof parsed === "object" && parsed !== null ? parsed : {}),
      };
    } catch {
      initialPayload = { ...context, trigger: data.payload };
    }
  }

  const result = await step.run("manual-trigger", async () => initialPayload);

  await publish(
    manualTriggerChannel().status({
      nodeId,
      status: "success",
    }),
  );

  return result;
};
