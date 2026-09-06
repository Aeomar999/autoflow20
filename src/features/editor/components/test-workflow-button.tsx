"use client";

import { getDefaultStore } from "jotai";
import { FlaskConicalIcon, MousePointerClickIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTestWorkflow } from "@/features/workflows/hooks/use-workflows";
import { type EditorNode, edgesAtom, nodesAtom } from "../store/atoms";

const jotaiStore = getDefaultStore();

// `disabled` is load-bearing: buildTestGraph reads it to mark the nodes the
// engine must skip. Dropping it here silently ran every disabled node.
const takeDraftNodes = () =>
  jotaiStore
    .get(nodesAtom)
    .filter((n): n is EditorNode & { type: string } => Boolean(n.type))
    .map((n) => ({
      id: n.id,
      type: n.type,
      data: n.data,
      disabled: n.disabled,
    }));

export const TestWorkflowButton = ({ workflowId }: { workflowId: string }) => {
  const testWorkflow = useTestWorkflow();

  const handleTest = () => {
    const nodes = takeDraftNodes();
    if (nodes.length === 0) return;
    testWorkflow.mutate({
      id: workflowId,
      nodes,
      edges: jotaiStore.get(edgesAtom),
    });
  };

  const hasNodes = jotaiStore.get(nodesAtom).length > 0;

  return (
    <Button
      size="lg"
      variant="secondary"
      onClick={handleTest}
      disabled={testWorkflow.isPending || !hasNodes}
      title="Run the current draft as a test"
    >
      <FlaskConicalIcon className="size-4" />
      Test workflow
    </Button>
  );
};

export const TestSelectedNodeButton = ({
  workflowId,
}: {
  workflowId: string;
}) => {
  const testWorkflow = useTestWorkflow();

  const handleTestNode = () => {
    const selectedId = jotaiStore.get(nodesAtom).find((n) => n.selected)?.id;
    const nodes = takeDraftNodes();
    if (!selectedId || nodes.length === 0) return;
    testWorkflow.mutate({
      id: workflowId,
      nodes,
      edges: jotaiStore.get(edgesAtom),
      testNodeId: selectedId,
    });
  };

  const isSingleSelected =
    jotaiStore.get(nodesAtom).filter((n) => n.selected).length === 1;

  return (
    <Button
      size="lg"
      variant="secondary"
      onClick={handleTestNode}
      disabled={testWorkflow.isPending || !isSingleSelected}
      title={
        isSingleSelected
          ? "Run only the selected node as a test"
          : "Select exactly one node to test it"
      }
    >
      <MousePointerClickIcon className="size-4" />
      Test node
    </Button>
  );
};
