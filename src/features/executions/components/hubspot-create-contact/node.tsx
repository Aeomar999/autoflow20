"use client";

import { type Node, type NodeProps, useReactFlow } from "@xyflow/react";
import { Contact } from "lucide-react";
import { memo, useCallback, useState } from "react";
import { useNodeStatus } from "../../hooks/use-node-status";
import { BaseExecutionNode } from "../base-execution-node";
import {
  HubSpotCreateContactDialog,
  type HubSpotCreateContactFormValues,
} from "./dialog";

type HubSpotCreateContactNodeData = {
  variableName?: string;
  credentialId?: string;
  properties?: string;
};

type HubSpotCreateContactNodeType = Node<HubSpotCreateContactNodeData>;

export const HubSpotCreateContactNode = memo(
  (props: NodeProps<HubSpotCreateContactNodeType>) => {
    const [dialogOpen, setDialogOpen] = useState(false);
    const { setNodes } = useReactFlow();

    const nodeStatus = useNodeStatus({ nodeId: props.id });

    const handleOpenSettings = useCallback(() => setDialogOpen(true), []);

    const handleSubmit = (values: HubSpotCreateContactFormValues) => {
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
    const description = nodeData?.properties
      ? "Create contact in HubSpot"
      : "Not configured";

    return (
      <>
        <HubSpotCreateContactDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onSubmit={handleSubmit}
          defaultValues={nodeData}
        />
        <BaseExecutionNode
          {...props}
          id={props.id}
          icon={Contact}
          name="HubSpot Create Contact"
          status={nodeStatus}
          description={description}
          onSettings={handleOpenSettings}
          onDoubleClick={handleOpenSettings}
        />
      </>
    );
  },
);

HubSpotCreateContactNode.displayName = "HubSpotCreateContactNode";
