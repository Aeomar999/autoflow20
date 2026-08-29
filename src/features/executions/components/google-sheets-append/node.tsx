"use client";

import { type Node, type NodeProps, useReactFlow } from "@xyflow/react";
import { Table2 } from "lucide-react";
import { memo, useCallback, useState } from "react";
import { useNodeStatus } from "../../hooks/use-node-status";
import { BaseExecutionNode } from "../base-execution-node";
import {
  GoogleSheetsAppendDialog,
  type GoogleSheetsAppendFormValues,
} from "./dialog";

type GoogleSheetsAppendNodeData = {
  variableName?: string;
  credentialId?: string;
  spreadsheetId?: string;
  sheetName?: string;
  values?: string;
};

type GoogleSheetsAppendNodeType = Node<GoogleSheetsAppendNodeData>;

export const GoogleSheetsAppendNode = memo(
  (props: NodeProps<GoogleSheetsAppendNodeType>) => {
    const [dialogOpen, setDialogOpen] = useState(false);
    const { setNodes } = useReactFlow();

    const nodeStatus = useNodeStatus({ nodeId: props.id });

    const handleOpenSettings = useCallback(() => setDialogOpen(true), []);

    const handleSubmit = (values: GoogleSheetsAppendFormValues) => {
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
    const description = nodeData?.sheetName
      ? `Append to ${nodeData.sheetName}`
      : "Not configured";

    return (
      <>
        <GoogleSheetsAppendDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onSubmit={handleSubmit}
          defaultValues={nodeData}
        />
        <BaseExecutionNode
          {...props}
          icon={Table2}
          name="Google Sheets Append"
          status={nodeStatus}
          description={description}
          onSettings={handleOpenSettings}
          onDoubleClick={handleOpenSettings}
        />
      </>
    );
  },
);

GoogleSheetsAppendNode.displayName = "GoogleSheetsAppendNode";
