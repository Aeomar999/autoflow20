import { createId } from "@paralleldrive/cuid2";
import { inngest } from "./client";

export const sendWorkflowExecution = async (data: {
  workflowId: string;
  initialData?: Record<string, unknown>;
  executionId?: string;
  skipNodes?: string[];
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
      ...data.initialData,
    },
    id: eventId,
  });
  return { eventId };
};