import { createId } from "@paralleldrive/cuid2";
import type { TestGraph } from "@/features/workflows/server/test-run";
import { inngest } from "./client";

export const sendWorkflowExecution = async (data: {
  workflowId: string;
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
      ...(data.executionId ? { executionId: data.executionId } : {}),
      ...(data.skipNodes && data.skipNodes.length > 0
        ? { skipNodes: data.skipNodes }
        : {}),
      ...(data.skipReason ? { skipReason: data.skipReason } : {}),
      ...(data.endAfterNodeId ? { endAfterNodeId: data.endAfterNodeId } : {}),
      ...(data.graphSnapshot ? { graphSnapshot: data.graphSnapshot } : {}),
      ...data.initialData,
    },
    id: eventId,
  });
  return { eventId };
};
