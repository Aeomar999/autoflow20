"use client";

import { type Node, type NodeProps, useReactFlow } from "@xyflow/react";
import { Bot } from "lucide-react";
import { memo, useCallback, useState } from "react";
import { useNodeStatus } from "../../hooks/use-node-status";
import { BaseExecutionNode } from "../base-execution-node";
import {
  OpenAiCompatibleChatDialog,
  type OpenAiCompatibleChatFormValues,
} from "./dialog";

type OpenAiCompatibleChatNodeData = {
  variableName?: string;
  credentialId?: string;
  baseUrl?: string;
  model?: string;
  systemPrompt?: string;
  userPrompt?: string;
};

type OpenAiCompatibleChatNodeType = Node<OpenAiCompatibleChatNodeData>;

export const OpenAiCompatibleChatNode = memo(
  (props: NodeProps<OpenAiCompatibleChatNodeType>) => {
    const [dialogOpen, setDialogOpen] = useState(false);
    const { setNodes } = useReactFlow();

    const nodeStatus = useNodeStatus({ nodeId: props.id });

    const handleOpenSettings = useCallback(() => setDialogOpen(true), []);

    const handleSubmit = (values: OpenAiCompatibleChatFormValues) => {
      setNodes((nodes) =>
        nodes.map((node) => {
          if (node.id === props.id) {
            return {
              ...node,
              data: {
                ...node.data,
                ...values,
              },
            };
          }
          return node;
        }),
      );
    };

    const nodeData = props.data;
    const description = nodeData?.model
      ? `Chat with ${nodeData.model}`
      : "Not configured";

    return (
      <>
        <OpenAiCompatibleChatDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onSubmit={handleSubmit}
          defaultValues={nodeData}
        />
        <BaseExecutionNode
          {...props}
          id={props.id}
          icon={Bot}
          name="OpenAI-Compatible"
          status={nodeStatus}
          description={description}
          onSettings={handleOpenSettings}
          onDoubleClick={handleOpenSettings}
        />
      </>
    );
  },
);

OpenAiCompatibleChatNode.displayName = "OpenAiCompatibleChatNode";
