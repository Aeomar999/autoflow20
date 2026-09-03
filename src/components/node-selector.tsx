"use client";

import { createId } from "@paralleldrive/cuid2";
import { useReactFlow } from "@xyflow/react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { InfoIcon, SearchIcon, XIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { NodeIcon } from "@/components/node-icon";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  appendSourceNodeIdAtom,
  type EditorNode,
  edgesAtom,
  nodeSelectorOpenAtom,
  nodesAtom,
  saveStatusAtom,
} from "@/features/editor/store/atoms";
import { nodeManifest, nodePalette } from "@/nodes/manifest";
import { defaultInputId, defaultOutputId } from "@/nodes/ports";
import type { NodeCategory, NodeDefinition } from "@/nodes/types";

export type NodeTypeOption = {
  type: string;
  label: string;
  description: string;
  category?: NodeCategory;
  keywords?: string[];
  icon?: string | React.ComponentType<{ className?: string }>;
};

const CATEGORY_META: Record<
  NodeCategory,
  { label: string; description: string; order: number }
> = {
  TRIGGER: {
    label: "Triggers",
    description: "Start a workflow run on events or schedules",
    order: 1,
  },
  AI: {
    label: "AI Models",
    description: "Generate, extract, and transform with LLMs",
    order: 2,
  },
  ACTION: {
    label: "Actions & Integrations",
    description: "Connect to third-party services, databases, and APIs",
    order: 3,
  },
  LOGIC: {
    label: "Logic & Flow",
    description: "Branch, merge, and control execution paths",
    order: 4,
  },
  TRANSFORM: {
    label: "Transform",
    description: "Mutate, filter, and structure run data",
    order: 5,
  },
  DATA: {
    label: "Data & Storage",
    description: "Query databases and cloud spreadsheets",
    order: 6,
  },
};

interface NodeSelectorProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  sourceNodeId?: string | null;
  children?: React.ReactNode;
}

export function NodeSelector({
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  sourceNodeId: explicitSourceNodeId,
  children,
}: NodeSelectorProps) {
  const [globalOpen, setGlobalOpen] = useAtom(nodeSelectorOpenAtom);
  const [appendSourceId, setAppendSourceId] = useAtom(appendSourceNodeIdAtom);

  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : globalOpen;

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        setAppendSourceId(null);
      }
      if (isControlled && controlledOnOpenChange) {
        controlledOnOpenChange(nextOpen);
      } else {
        setGlobalOpen(nextOpen);
      }
    },
    [isControlled, controlledOnOpenChange, setGlobalOpen, setAppendSourceId],
  );

  const [searchQuery, setSearchQuery] = useState("");

  const nodes = useAtomValue(nodesAtom);
  const setNodes = useSetAtom(nodesAtom);
  const setEdges = useSetAtom(edgesAtom);
  const setSaveStatus = useSetAtom(saveStatusAtom);

  const reactFlow = useReactFlow();

  const activeSourceId = explicitSourceNodeId ?? appendSourceId;

  const hasTrigger = useMemo(() => {
    return nodes.some((node) => {
      if (node.type === "INITIAL") return true;
      const match = nodeManifest.find((entry) => entry.type === node.type);
      return match?.category === "TRIGGER";
    });
  }, [nodes]);

  // Filter nodes by search query
  const filteredNodes = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return nodePalette;

    const tokens = query.split(/\s+/).filter(Boolean);

    return nodePalette.filter((node) => {
      const searchSpace = [
        node.label,
        node.description,
        node.type,
        ...(node.keywords ?? []),
        CATEGORY_META[node.category]?.label ?? node.category,
      ]
        .join(" ")
        .toLowerCase();

      return tokens.every((token) => searchSpace.includes(token));
    });
  }, [searchQuery]);

  // Group filtered nodes by category
  const groupedCategories = useMemo(() => {
    const groups = new Map<NodeCategory, NodeDefinition[]>();

    for (const node of filteredNodes) {
      const existing = groups.get(node.category) ?? [];
      existing.push(node);
      groups.set(node.category, existing);
    }

    return Array.from(groups.entries()).sort(
      ([catA], [catB]) =>
        (CATEGORY_META[catA]?.order ?? 99) - (CATEGORY_META[catB]?.order ?? 99),
    );
  }, [filteredNodes]);

  const handleNodeSelect = useCallback(
    (selection: NodeDefinition | NodeTypeOption) => {
      const category =
        selection.category ??
        nodeManifest.find((m) => m.type === selection.type)?.category;

      if (category === "TRIGGER" && hasTrigger) {
        toast.error(
          "Workflows can only have one trigger. Remove the existing trigger to add a new one.",
        );
        return;
      }

      const hasInitialTrigger = nodes.some((node) => node.type === "INITIAL");
      const sourceNode = activeSourceId
        ? nodes.find((n) => n.id === activeSourceId)
        : null;

      let position = { x: 0, y: 0 };

      if (sourceNode) {
        position = {
          x: sourceNode.position.x + 280,
          y: sourceNode.position.y + (Math.random() - 0.5) * 50,
        };
      } else {
        const centerX = window.innerWidth / 2;
        const centerY = window.innerHeight / 2;
        const flowPos = reactFlow.screenToFlowPosition({
          x: centerX,
          y: centerY,
        });
        position = {
          x: flowPos.x + (Math.random() - 0.5) * 100,
          y: flowPos.y + (Math.random() - 0.5) * 100,
        };
      }

      const newNodeId = createId();
      const newNode: EditorNode = {
        id: newNodeId,
        type: selection.type,
        data: {},
        name: selection.label,
        position,
      };

      if (hasInitialTrigger && !sourceNode) {
        setNodes([newNode]);
      } else {
        setNodes((prev) => [...prev, newNode]);
      }

      // Auto-connect if appended from a source node. AF-M9-03: the handle ids
      // are the declared `PortDef.id`s, which `saveGraph` persists verbatim as
      // `Connection.fromOutput`/`toInput` — hardcoding "source-1"/"target-1"
      // here is what made every branching edge unmatchable by the engine.
      if (sourceNode) {
        const newEdge = {
          id: createId(),
          source: sourceNode.id,
          // React Flow types `Node.type` as optional; an untyped node falls
          // back to the "main" default rather than emitting a null handle.
          // AF-M9-09: pass the source node's config so config-dependent nodes
          // (SWITCH) land on their first real branch, not an invented port.
          sourceHandle: defaultOutputId(sourceNode.type ?? "", sourceNode.data),
          target: newNodeId,
          targetHandle: defaultInputId(selection.type, newNode.data),
        };
        setEdges((prev) => [...prev, newEdge]);
      }

      setSaveStatus("unsaved");
      handleOpenChange(false);
      setSearchQuery("");
    },
    [
      hasTrigger,
      nodes,
      activeSourceId,
      reactFlow,
      setNodes,
      setEdges,
      setSaveStatus,
      handleOpenChange,
    ],
  );

  return (
    <Sheet open={isOpen} onOpenChange={handleOpenChange}>
      {children && <SheetTrigger asChild>{children}</SheetTrigger>}
      <SheetContent
        side="right"
        className="w-full sm:max-w-lg overflow-y-auto flex flex-col p-0 gap-0"
      >
        <div className="p-6 pb-4 border-b space-y-3 shrink-0 bg-background sticky top-0 z-10">
          <SheetHeader className="p-0 space-y-1">
            <SheetTitle className="text-lg font-bold">
              {activeSourceId ? "Append next step" : "Add node to workflow"}
            </SheetTitle>
            <SheetDescription className="text-xs">
              {activeSourceId
                ? "Select a node to connect directly to the current step."
                : "Choose a trigger, AI model, or action to add to your canvas."}
            </SheetDescription>
          </SheetHeader>

          {/* Search Input */}
          <div className="relative">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name, category, or keyword (e.g. webhook, AI, slack)..."
              className="pl-9 pr-8 h-9 text-sm"
              autoFocus
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <XIcon className="size-4" />
              </button>
            )}
          </div>
        </div>

        {/* Node Categories List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {groupedCategories.length === 0 ? (
            <div className="text-center py-12 px-4 space-y-2">
              <p className="text-sm font-medium text-foreground">
                No nodes found
              </p>
              <p className="text-xs text-muted-foreground max-w-xs mx-auto">
                No workflow nodes match &quot;{searchQuery}&quot;. Try searching
                for another term or service.
              </p>
            </div>
          ) : (
            groupedCategories.map(([category, categoryNodes]) => {
              const meta = CATEGORY_META[category] ?? {
                label: category,
                description: "",
              };
              const isTriggerCategory = category === "TRIGGER";
              const isTriggerDisabled = isTriggerCategory && hasTrigger;

              return (
                <div key={category} className="space-y-2">
                  <div className="flex items-center justify-between px-2">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                          {meta.label}
                        </h4>
                        <Badge
                          variant="secondary"
                          className="text-[10px] px-1.5 py-0 h-4 font-normal"
                        >
                          {categoryNodes.length}
                        </Badge>
                      </div>
                    </div>
                  </div>

                  {isTriggerDisabled && (
                    <div className="mx-2 p-2.5 rounded-md bg-warning/10 border border-warning/25 text-warning text-xs flex items-start gap-2">
                      <InfoIcon className="size-4 shrink-0 mt-0.5 text-warning" />
                      <span>
                        Workflows can only have one trigger. Remove the active
                        trigger on the canvas to select a different one.
                      </span>
                    </div>
                  )}

                  <div className="grid grid-cols-1 gap-1.5">
                    {categoryNodes.map((node) => {
                      const isDisabled = isTriggerDisabled;

                      return (
                        <button
                          type="button"
                          key={node.type}
                          draggable={!isDisabled}
                          onDragStart={(e) => {
                            if (isDisabled) {
                              e.preventDefault();
                              return;
                            }
                            e.dataTransfer.setData(
                              "application/reactflow",
                              node.type,
                            );
                            e.dataTransfer.effectAllowed = "move";
                          }}
                          className={`group relative flex items-start gap-3 p-3 rounded-lg border border-border/50 bg-card hover:bg-accent/50 hover:border-border text-left transition-all cursor-pointer ${
                            isDisabled
                              ? "opacity-50 cursor-not-allowed hover:bg-card hover:border-border/50"
                              : "hover:shadow-xs active:scale-[0.99]"
                          }`}
                          onClick={() => handleNodeSelect(node)}
                        >
                          <div className="mt-0.5 p-2 rounded-md bg-muted/60 border border-border/40 group-hover:bg-background transition-colors shrink-0">
                            <NodeIcon
                              type={node.type}
                              iconName={node.icon}
                              logo={node.logo}
                              label={node.label}
                              className="size-5"
                            />
                          </div>

                          <div className="flex-1 min-w-0 space-y-0.5">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-semibold text-sm text-foreground truncate">
                                {node.label}
                              </span>
                              {node.keywords && node.keywords.length > 0 && (
                                <span className="text-[10px] text-muted-foreground/60 hidden group-hover:inline-block">
                                  {node.keywords[0]}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                              {node.description}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
