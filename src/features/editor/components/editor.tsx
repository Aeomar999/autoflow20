"use client";

import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  type Connection,
  Controls,
  type Edge,
  type EdgeChange,
  MiniMap,
  type Node,
  type NodeChange,
  Panel,
  ReactFlow,
} from "@xyflow/react";
import { useAtomValue, useSetAtom } from "jotai";
import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { ErrorView, LoadingView } from "@/components/entity-components";
import { nodeComponents } from "@/config/node-components";
import { useSuspenseWorkflow } from "@/features/workflows/hooks/use-workflows";
import {
  edgesAtom,
  editorAtom,
  nodesAtom,
  saveStatusAtom,
} from "../store/atoms";
import { NodeStatusProvider } from "../store/node-status-context";
import { AddNodeButton } from "./add-node-button";
import { ExecuteWorkflowButton } from "./execute-workflow-button";

import "@xyflow/react/dist/style.css";

export const EditorLoading = () => {
  return <LoadingView message="Loading editor..." />;
};

export const EditorError = () => {
  return <ErrorView message="Error loading editor" />;
};

export const Editor = memo(function Editor({
  workflowId,
}: {
  workflowId: string;
}) {
  const { data: workflow } = useSuspenseWorkflow(workflowId);

  const setEditor = useSetAtom(editorAtom);
  const setNodes = useSetAtom(nodesAtom);
  const setEdges = useSetAtom(edgesAtom);
  const setSaveStatus = useSetAtom(saveStatusAtom);

  const nodes = useAtomValue(nodesAtom);
  const edges = useAtomValue(edgesAtom);

  // Snapshot of the last server-known state. Used to compute isDirty.
  const serverSnapshotRef = useRef<{
    nodes: Node[];
    edges: Edge[];
  } | null>(null);

  // Initialize atoms from server data; rebuild snapshot on workflow refetch
  // (e.g. after CONFLICT reload or successful save + query invalidation).
  useEffect(() => {
    setNodes(workflow.nodes);
    setEdges(workflow.edges);
    serverSnapshotRef.current = {
      nodes: structuredClone(workflow.nodes),
      edges: structuredClone(workflow.edges),
    };
    setSaveStatus("saved");
  }, [workflow, setNodes, setEdges, setSaveStatus]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((prev) => applyNodeChanges(changes, prev));
      setSaveStatus("unsaved");
    },
    [setNodes, setSaveStatus],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setEdges((prev) => applyEdgeChanges(changes, prev));
      setSaveStatus("unsaved");
    },
    [setEdges, setSaveStatus],
  );

  const onConnect = useCallback(
    (params: Connection) => {
      setEdges((prev) => addEdge(params, prev));
      setSaveStatus("unsaved");
    },
    [setEdges, setSaveStatus],
  );

  const hasManualTrigger = useMemo(
    () => nodes.some((node) => node.type === "MANUAL_TRIGGER"),
    [nodes],
  );

  return (
    <div className="size-full">
      <NodeStatusProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeComponents}
          onInit={setEditor}
          fitView
          snapGrid={[10, 10]}
          snapToGrid
          panOnScroll
          panOnDrag={false}
          selectionOnDrag
        >
          <Background />
          <Controls />
          <MiniMap />
          <Panel position="top-right">
            <AddNodeButton />
          </Panel>
          {hasManualTrigger && (
            <Panel position="bottom-center">
              <ExecuteWorkflowButton workflowId={workflowId} />
            </Panel>
          )}
        </ReactFlow>
      </NodeStatusProvider>
    </div>
  );
});
