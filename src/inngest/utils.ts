import { createId } from "@paralleldrive/cuid2";
import type { TestGraph } from "@/features/workflows/server/test-run";
import { inngest } from "./client";

export const sendWorkflowExecution = async (data: {
  workflowId: string;
  userId?: string;
  organizationId?: string;
  initialData?: Record<string, unknown>;
  executionId?: string;
  skipNodes?: string[];
  skipReason?: string;
  endAfterNodeId?: string;
  graphSnapshot?: TestGraph;
}): Promise<{ eventId: string }> => {
  const eventId = createId();
  await inngest.send({
    name: "workflows/execute.workflow",
    data: {
      workflowId: data.workflowId,
      ...(data.userId ? { userId: data.userId } : {}),
      ...(data.organizationId ? { organizationId: data.organizationId } : {}),
      ...(data.executionId ? { executionId: data.executionId } : {}),
      ...(data.skipNodes && data.skipNodes.length > 0
        ? { skipNodes: data.skipNodes }
        : {}),
      ...(data.skipReason ? { skipReason: data.skipReason } : {}),
      ...(data.endAfterNodeId ? { endAfterNodeId: data.endAfterNodeId } : {}),
      ...(data.graphSnapshot ? { graphSnapshot: data.graphSnapshot } : {}),
      // AF-M10-34: nested, not spread. The engine reads the run's starting
      // context as `event.data.initialData`; spreading put the payload's keys
      // alongside `workflowId` instead, so every trigger's data was dropped
      // and a real run started from an empty context — `{{webhook.body}}`,
      // `{{form.fields}}` and `{{telegram.text}}` all resolved to nothing.
      // Only the integration harness passed it in the shape the engine reads,
      // which is why the suite never noticed.
      ...(data.initialData ? { initialData: data.initialData } : {}),
    },
    id: eventId,
  });
  return { eventId };
};
