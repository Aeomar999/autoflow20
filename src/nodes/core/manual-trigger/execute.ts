import "server-only";
import { manualTriggerChannel } from "@/inngest/channels/manual-trigger";
import type { NodeRun } from "@/nodes/types";
import { z } from "zod";
import { configSchema } from "./definition";

export const execute: NodeRun<z.infer<typeof configSchema>> = async ({
  nodeId,
  context,
  data,
  step,
  publish,
}) => {
  await publish(
    manualTriggerChannel().status({
      nodeId,
      status: "loading",
    }),
  );

  const result = await step.run("manual-trigger", async () => {
    let parsedPayload = {};
    if (data.payload) {
      try {
        parsedPayload = JSON.parse(data.payload);
      } catch (err) {
        // Fallback or just ignore if it's invalid JSON
      }
    }
    return {
      ...context,
      trigger: parsedPayload,
    };
  });

  await publish(
    manualTriggerChannel().status({
      nodeId,
      status: "success",
    }),
  );

  return result;
};
