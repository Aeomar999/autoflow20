"use client";

import { createId } from "@paralleldrive/cuid2";
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
  ReactFlowProvider,
} from "@xyflow/react";
import { useAtomValue, useSetAtom } from "jotai";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ErrorView, LoadingView } from "@/components/entity-components";
import { NodeSelector } from "@/components/node-selector";
import { nodeComponents } from "@/config/node-components";
import { useSuspenseWorkflow } from "@/features/workflows/hooks/use-workflows";
import { findManifestEntry } from "@/nodes/manifest";
import {
  isInitialReplaceDismissed,
  resolveInitialReplaceBehavior,
} from "../lib/initial-replace";
import {
  type EditorNode,
  edgesAtom,
  editorAtom,
  nodesAtom,
  saveStatusAtom,
  selectedNodeIdAtom,
} from "../store/atoms";
import { NodeStatusProvider } from "../store/node-status-context";
import { AddNodeButton } from "./add-node-button";
import { CostEstimateBadge } from "./cost-estimate-badge";
import { ExecuteWorkflowButton } from "./execute-workflow-button";
import { InitialTriggerReplaceDialog } from "./initial-trigger-replace-dialog";
import { NodeConfigPanel } from "./node-config-panel";
import { NotificationPrefsToggle } from "./notification-prefs-toggle";
import {
  TestSelectedNodeButton,
  TestWorkflowButton,
} from "./test-workflow-button";
import { ValidationPanel } from "./validation-panel";

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
  const selectedNodeId = useAtomValue(selectedNodeIdAtom);
  const setSelectedNodeId = useSetAtom(selectedNodeIdAtom);

  // A node waiting on the AF-UX-04 confirm dialog before it may replace the
  // INITIAL placeholder trigger. null while idle.
  const [pendingDrop, setPendingDrop] = useState<EditorNode | null>(null);

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

      const hasMeaningfulChange = changes.some(
        (c) => c.type !== "dimensions" && c.type !== "select",
      );
      if (hasMeaningfulChange) {
        setSaveStatus("unsaved");
      }
    },
    [setNodes, setSaveStatus],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setEdges((prev) => applyEdgeChanges(changes, prev));

      const hasMeaningfulChange = changes.some((c) => c.type !== "select");
      if (hasMeaningfulChange) {
        setSaveStatus("unsaved");
      }
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

  const onSelectionChange = useCallback(
    ({ nodes: selected }: { nodes: Node[] }) => {
      setSelectedNodeId(selected.length === 1 ? selected[0].id : null);
    },
    [setSelectedNodeId],
  );

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  );

  const selectedDefinition = useMemo(() => {
    if (!selectedNode || !selectedNode.type) return undefined;
    const manifestEntry = findManifestEntry(selectedNode.type);
    if (manifestEntry) return manifestEntry;
    // "INITIAL" is a persisted alias of the manual trigger until M1-02 migrates rows.
    return selectedNode.type === "INITIAL"
      ? findManifestEntry("MANUAL_TRIGGER")
      : undefined;
  }, [selectedNode]);

  const patchSelectedNode = useCallback(
    (patch: Partial<EditorNode>) => {
      if (!selectedNodeId) return;
      setNodes((prev) =>
        prev.map((node) =>
          node.id === selectedNodeId ? { ...node, ...patch } : node,
        ),
      );
      setSaveStatus("unsaved");
    },
    [selectedNodeId, setNodes, setSaveStatus],
  );

  const hasManualTrigger = useMemo(
    () => nodes.some((node) => node.type === "MANUAL_TRIGGER"),
    [nodes],
  );

  // AF-UX-04: the user confirmed replacing the INITIAL placeholder trigger.
  const commitInitialReplace = useCallback(() => {
    if (pendingDrop) {
      setNodes([pendingDrop]);
      setSaveStatus("unsaved");
    }
    setPendingDrop(null);
  }, [pendingDrop, setNodes, setSaveStatus]);

  const editorInstance = useAtomValue(editorAtom);

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const type = event.dataTransfer.getData("application/reactflow");
      if (!type) return;

      const definition = findManifestEntry(type);
      if (!definition) return;

      if (definition.category === "TRIGGER") {
        const hasTrigger = nodes.some((n) => {
          if (n.type === "INITIAL") return true;
          const def = n.type ? findManifestEntry(n.type) : undefined;
          return def?.category === "TRIGGER";
        });
        if (hasTrigger) {
          toast.error(
            "Workflows can only have one trigger. Remove the existing trigger to add a new one.",
          );
          return;
        }
      }

      const flowPosition = editorInstance?.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      }) ?? { x: 0, y: 0 };

      const hasInitialTrigger = nodes.some((node) => node.type === "INITIAL");

      const newNode: EditorNode = {
        id: createId(),
        type: definition.type,
        data: {},
        name: definition.label,
        position: flowPosition,
      };

      // AF-UX-04: replacing the seed INITIAL trigger is destructive — ask
      // first unless the user dismissed the prompt.
      const behavior = resolveInitialReplaceBehavior(
        hasInitialTrigger,
        isInitialReplaceDismissed(),
      );
      if (behavior === "confirm") {
        setPendingDrop(newNode);
        return;
      }

      if (hasInitialTrigger) {
        setNodes([newNode]);
      } else {
        setNodes((prev) => [...prev, newNode]);
      }
      setSaveStatus("unsaved");
    },
    [editorInstance, nodes, setNodes, setSaveStatus],
  );

  return (
    <div className="relative size-full">
      <ReactFlowProvider>
        <NodeStatusProvider>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onSelectionChange={onSelectionChange}
            onDragOver={onDragOver}
            onDrop={onDrop}
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
            <Panel position="bottom-center">
              <div className="flex flex-col items-center gap-2 mb-4">
                <CostEstimateBadge />
                {hasManualTrigger && (
                  <ExecuteWorkflowButton workflowId={workflowId} />
                )}
                <div className="flex items-center gap-2">
                  <TestWorkflowButton workflowId={workflowId} />
                  <TestSelectedNodeButton workflowId={workflowId} />
                  <NotificationPrefsToggle workflowId={workflowId} />
                </div>
              </div>
            </Panel>
            <ValidationPanel />
          </ReactFlow>
        </NodeStatusProvider>
        {selectedNode && selectedDefinition ? (
          <NodeConfigPanel
            workflowId={workflowId}
            node={selectedNode}
            definition={selectedDefinition}
            onNodeChange={patchSelectedNode}
          />
        ) : null}
        <NodeSelector />
        <InitialTriggerReplaceDialog
          open={pendingDrop !== null}
          nodeName={pendingDrop?.name ?? ""}
          onConfirm={commitInitialReplace}
          onCancel={() => setPendingDrop(null)}
        />
      </ReactFlowProvider>
    </div>
  );
});
