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
  nodeSelectorOpenAtom,
  nodesAtom,
  saveStatusAtom,
  selectedNodeIdAtom,
} from "../store/atoms";
import { NodeStatusProvider } from "../store/node-status-context";
import { useGraphHistory } from "../store/use-graph-history";
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

  const nodeSelectorOpen = useAtomValue(nodeSelectorOpenAtom);

  // AF-UX-05: undo/redo history seeded from server data. Disabled while an
  // overlay owns the keyboard so shortcuts never mutate the graph under it.
  const { commit: historyCommit, ensureInitialized } = useGraphHistory({
    disabled: pendingDrop !== null || nodeSelectorOpen,
  });

  // Typed-config edits coalesce into one undo step per burst (leading edge).
  const CONFIG_TYPING_FOLD_MS = 400;
  // Node + connected-edge removals for one delete gesture fold into one step.
  const STRUCTURAL_FOLD_MS = 150;

  // Snapshot of the last server-known state. Used to compute isDirty.
  const serverSnapshotRef = useRef<{
    nodes: Node[];
    edges: Edge[];
  } | null>(null);

  // Initialize atoms from server data; rebuild snapshot on workflow refetch
  // (e.g. after CONFLICT reload or successful save + query invalidation).
  // History is seeded once per Editor mount; later refetches leave undo intact.
  useEffect(() => {
    ensureInitialized({ nodes: workflow.nodes, edges: workflow.edges });
    setNodes(workflow.nodes);
    setEdges(workflow.edges);
    serverSnapshotRef.current = {
      nodes: structuredClone(workflow.nodes),
      edges: structuredClone(workflow.edges),
    };
    setSaveStatus("saved");
  }, [workflow, setNodes, setEdges, setSaveStatus, ensureInitialized]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      let nextNodes: EditorNode[] | null = null;
      setNodes((prev) => {
        nextNodes = applyNodeChanges(changes, prev);
        return nextNodes;
      });
      if (nextNodes !== null && changes.some((c) => c.type === "remove")) {
        // One undo step per delete gesture; the connected-edge removals that
        // follow fold into this same step via STRUCTURAL_FOLD_MS.
        historyCommit({ nodes: nextNodes, edges }, STRUCTURAL_FOLD_MS);
      }

      const hasMeaningfulChange = changes.some(
        (c) => c.type !== "dimensions" && c.type !== "select",
      );
      if (hasMeaningfulChange) {
        setSaveStatus("unsaved");
      }
    },
    [edges, historyCommit, setNodes, setSaveStatus],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      let nextEdges: Edge[] | null = null;
      setEdges((prev) => {
        nextEdges = applyEdgeChanges(changes, prev);
        return nextEdges;
      });
      if (nextEdges !== null && changes.some((c) => c.type === "remove")) {
        historyCommit({ nodes, edges: nextEdges }, STRUCTURAL_FOLD_MS);
      }

      const hasMeaningfulChange = changes.some((c) => c.type !== "select");
      if (hasMeaningfulChange) {
        setSaveStatus("unsaved");
      }
    },
    [historyCommit, nodes, setEdges, setSaveStatus],
  );

  const onConnect = useCallback(
    (params: Connection) => {
      let nextEdges: Edge[] | null = null;
      setEdges((prev) => {
        nextEdges = addEdge(params, prev);
        return nextEdges;
      });
      if (nextEdges !== null) {
        historyCommit({ nodes, edges: nextEdges }, STRUCTURAL_FOLD_MS);
      }
      setSaveStatus("unsaved");
    },
    [historyCommit, nodes, setEdges, setSaveStatus],
  );

  // Completing a drag is the one undoable step for all position changes that
  // flowed through onNodesChange while the node moved.
  const onNodeDragStop = useCallback(() => {
    historyCommit({ nodes, edges });
  }, [edges, historyCommit, nodes]);

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
      let nextNodes: EditorNode[] | null = null;
      setNodes((prev) => {
        nextNodes = prev.map((node) =>
          node.id === selectedNodeId ? { ...node, ...patch } : node,
        );
        return nextNodes;
      });
      if (nextNodes !== null) {
        // Keystroke bursts coalesce into one undo step (AF-UX-05).
        historyCommit({ nodes: nextNodes, edges }, CONFIG_TYPING_FOLD_MS);
      }
      setSaveStatus("unsaved");
    },
    [edges, historyCommit, selectedNodeId, setNodes, setSaveStatus],
  );

  const hasManualTrigger = useMemo(
    () => nodes.some((node) => node.type === "MANUAL_TRIGGER"),
    [nodes],
  );

  // AF-UX-04: the user confirmed replacing the INITIAL placeholder trigger.
  const commitInitialReplace = useCallback(() => {
    if (pendingDrop) {
      setNodes([pendingDrop]);
      historyCommit({ nodes: [pendingDrop], edges }, STRUCTURAL_FOLD_MS);
      setSaveStatus("unsaved");
    }
    setPendingDrop(null);
  }, [edges, historyCommit, pendingDrop, setNodes, setSaveStatus]);

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
        historyCommit({ nodes: [newNode], edges }, STRUCTURAL_FOLD_MS);
      } else {
        let nextNodes: EditorNode[] | null = null;
        setNodes((prev) => {
          nextNodes = [...prev, newNode];
          return nextNodes;
        });
        if (nextNodes !== null) {
          historyCommit({ nodes: nextNodes, edges }, STRUCTURAL_FOLD_MS);
        }
      }
      setSaveStatus("unsaved");
    },
    [edges, historyCommit, editorInstance, nodes, setNodes, setSaveStatus],
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
            onNodeDragStop={onNodeDragStop}
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
