import "server-only";
import { manualTriggerChannel } from "@/inngest/channels/manual-trigger";
import type { NodeRun } from "@/nodes/types";

/**
 * Webhook trigger: passes the context through unchanged.
 *
 * Not a stub — there is genuinely nothing to do here. The request has already
 * been received, authenticated and rate-limited by
 * `/api/webhooks/[workflowId]/[path]`, which seeds the run with
 * `initialData.webhook.*` before the engine starts. This node exists so the
 * canvas has an entry point and the trace has a row for it.
 */
export const execute: NodeRun = async ({ nodeId, context, step, publish }) => {
  await publish(
    manualTriggerChannel().status({
      nodeId,
      status: "loading",
    }),
  );

  const result = await step.run("webhook-trigger", async () => context);

  await publish(
    manualTriggerChannel().status({
      nodeId,
      status: "success",
    }),
  );

  return result;
};
