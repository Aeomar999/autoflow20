"use client";

import { type NodeProps, Position, useReactFlow } from "@xyflow/react";
import { useSetAtom } from "jotai";
import { type LucideIcon, PlusIcon } from "lucide-react";
import Image from "next/image";
import { memo, type ReactNode, useCallback } from "react";
import { BaseHandle } from "@/components/react-flow/base-handle";
import { BaseNode, BaseNodeContent } from "@/components/react-flow/base-node";
import {
  type NodeStatus,
  NodeStatusIndicator,
} from "@/components/react-flow/node-status-indicator";
import { WorkflowNode } from "@/components/workflow-node";
import { NodeValidationBadge } from "@/features/editor/components/node-validation-badge";
import {
  appendSourceNodeIdAtom,
  nodeSelectorOpenAtom,
} from "@/features/editor/store/atoms";

interface BaseExecutionNodeProps extends NodeProps {
  icon: LucideIcon | string | React.ComponentType<{ className?: string }>;
  name: string;
  description?: string;
  children?: ReactNode;
  status?: NodeStatus;
  onSettings?: () => void;
  onDoubleClick?: () => void;
}

export const BaseExecutionNode = memo(
  ({
    id,
    icon: Icon,
    name,
    description,
    children,
    status = "initial",
    onSettings,
    onDoubleClick,
  }: BaseExecutionNodeProps) => {
    const { setNodes, setEdges } = useReactFlow();
    const setAppendSourceId = useSetAtom(appendSourceNodeIdAtom);
    const setSelectorOpen = useSetAtom(nodeSelectorOpenAtom);

    const handleAppend = useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation();
        setAppendSourceId(id);
        setSelectorOpen(true);
      },
      [id, setAppendSourceId, setSelectorOpen],
    );

    const handleDelete = () => {
      setNodes((currentNodes) => {
        const updatedNodes = currentNodes.filter((node) => node.id !== id);
        return updatedNodes;
      });

      setEdges((currentEdges) => {
        const updatedEdges = currentEdges.filter(
          (edge) => edge.source !== id && edge.target !== id,
        );
        return updatedEdges;
      });
    };

    return (
      <WorkflowNode
        name={name}
        description={description}
        onDelete={handleDelete}
        onSettings={onSettings}
      >
        <NodeStatusIndicator status={status} variant="border">
          <BaseNode status={status} onDoubleClick={onDoubleClick}>
            <BaseNodeContent>
              {typeof Icon === "string" ? (
                <Image src={Icon} alt={name} width={16} height={16} />
              ) : (
                <Icon className="size-4 text-muted-foreground" />
              )}
              {children}
              <BaseHandle
                id="target-1"
                type="target"
                position={Position.Left}
              />
              <BaseHandle
                id="source-1"
                type="source"
                position={Position.Right}
              />
              <button
                type="button"
                onClick={handleAppend}
                aria-label="Append connected node"
                title="Append next node"
                className="absolute -right-3.5 top-1/2 -translate-y-1/2 size-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all hover:scale-110 shadow-xs cursor-pointer z-10"
              >
                <PlusIcon className="size-3" />
              </button>
            </BaseNodeContent>
            <NodeValidationBadge nodeId={id} />
          </BaseNode>
        </NodeStatusIndicator>
      </WorkflowNode>
    );
  },
);

BaseExecutionNode.displayName = "BaseExecutionNode";
