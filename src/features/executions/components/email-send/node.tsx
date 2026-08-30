"use client";

import { type Node, type NodeProps, useReactFlow } from "@xyflow/react";
import { Mail } from "lucide-react";
import { memo, useCallback, useState } from "react";
import { useNodeStatus } from "../../hooks/use-node-status";
import { BaseExecutionNode } from "../base-execution-node";
import { EmailSendDialog, type EmailSendFormValues } from "./dialog";

type EmailSendNodeData = {
  variableName?: string;
  credentialId?: string;
  from?: string;
  fromName?: string;
  to?: string;
  cc?: string;
  bcc?: string;
  subject?: string;
  body?: string;
};

type EmailSendNodeType = Node<EmailSendNodeData>;

export const EmailSendNode = memo((props: NodeProps<EmailSendNodeType>) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { setNodes } = useReactFlow();

  const nodeStatus = useNodeStatus({ nodeId: props.id });

  const handleOpenSettings = useCallback(() => setDialogOpen(true), []);

  const handleSubmit = (values: EmailSendFormValues) => {
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
  const description = nodeData?.to
    ? `To: ${nodeData.to.slice(0, 50)}`
    : "Not configured";

  return (
    <>
      <EmailSendDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={handleSubmit}
        defaultValues={nodeData}
      />
      <BaseExecutionNode
        {...props}
        icon={Mail}
        name="Send Email"
        status={nodeStatus}
        description={description}
        onSettings={handleOpenSettings}
        onDoubleClick={handleOpenSettings}
      />
    </>
  );
});

EmailSendNode.displayName = "EmailSendNode";
