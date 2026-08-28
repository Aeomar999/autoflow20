"use client";

import { type Node, type NodeProps, useReactFlow } from "@xyflow/react";
import { Table } from "lucide-react";
import { memo, useCallback, useState } from "react";
import { useNodeStatus } from "../../hooks/use-node-status";
import { BaseExecutionNode } from "../base-execution-node";
import {
  AirtableCreateRecordDialog,
  type AirtableCreateRecordFormValues,
} from "./dialog";

type AirtableCreateRecordNodeData = {
  variableName?: string;
  credentialId?: string;
  baseId?: string;
  tableId?: string;
  fields?: string;
};

type AirtableCreateRecordNodeType = Node<AirtableCreateRecordNodeData>;

export const AirtableCreateRecordNode = memo(
  (props: NodeProps<AirtableCreateRecordNodeType>) => {
    const [dialogOpen, setDialogOpen] = useState(false);
    const { setNodes } = useReactFlow();

    const nodeStatus = useNodeStatus({ nodeId: props.id });

    const handleOpenSettings = useCallback(() => setDialogOpen(true), []);

    const handleSubmit = (values: AirtableCreateRecordFormValues) => {
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
    const description = nodeData?.tableId
      ? `Create record in ${nodeData.tableId}`
      : "Not configured";

    return (
      <>
        <AirtableCreateRecordDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onSubmit={handleSubmit}
          defaultValues={nodeData}
        />
        <BaseExecutionNode
          {...props}
          id={props.id}
          icon={Table}
          name="Airtable Create Record"
          status={nodeStatus}
          description={description}
          onSettings={handleOpenSettings}
          onDoubleClick={handleOpenSettings}
        />
      </>
    );
  },
);

AirtableCreateRecordNode.displayName = "AirtableCreateRecordNode";
