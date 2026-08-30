"use client";

import { type Node, type NodeProps, useReactFlow } from "@xyflow/react";
import { Webhook } from "lucide-react";
import { memo, useCallback, useState } from "react";
import { useNodeStatus } from "../../hooks/use-node-status";
import { BaseExecutionNode } from "../base-execution-node";
import { WebhookOutDialog, type WebhookOutFormValues } from "./dialog";

type WebhookOutNodeData = {
  variableName?: string;
  url?: string;
  body?: string;
};

type WebhookOutNodeType = Node<WebhookOutNodeData>;

export const WebhookOutNode = memo((props: NodeProps<WebhookOutNodeType>) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { setNodes } = useReactFlow();

  const nodeStatus = useNodeStatus({ nodeId: props.id });

  const handleOpenSettings = useCallback(() => setDialogOpen(true), []);

  const handleSubmit = (values: WebhookOutFormValues) => {
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
  const description = nodeData?.url
    ? `POST: ${nodeData.url}`
    : "Not configured";

  return (
    <>
      <WebhookOutDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={handleSubmit}
        defaultValues={nodeData}
      />
      <BaseExecutionNode
        {...props}
        icon={Webhook}
        name="Webhook"
        status={nodeStatus}
        description={description}
        onSettings={handleOpenSettings}
        onDoubleClick={handleOpenSettings}
      />
    </>
  );
});

WebhookOutNode.displayName = "WebhookOutNode";
