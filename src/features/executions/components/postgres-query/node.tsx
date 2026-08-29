"use client";

import { type Node, type NodeProps, useReactFlow } from "@xyflow/react";
import { Database } from "lucide-react";
import { memo, useCallback, useState } from "react";
import { useNodeStatus } from "../../hooks/use-node-status";
import { BaseExecutionNode } from "../base-execution-node";
import { PostgresQueryDialog, type PostgresQueryFormValues } from "./dialog";

type PostgresQueryNodeData = {
  variableName?: string;
  credentialId?: string;
  query?: string;
  params?: string;
};

type PostgresQueryNodeType = Node<PostgresQueryNodeData>;

export const PostgresQueryNode = memo(
  (props: NodeProps<PostgresQueryNodeType>) => {
    const [dialogOpen, setDialogOpen] = useState(false);
    const { setNodes } = useReactFlow();

    const nodeStatus = useNodeStatus({ nodeId: props.id });

    const handleOpenSettings = useCallback(() => setDialogOpen(true), []);

    const handleSubmit = (values: PostgresQueryFormValues) => {
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
    const description = nodeData?.query
      ? nodeData.query.slice(0, 50)
      : "Not configured";

    return (
      <>
        <PostgresQueryDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onSubmit={handleSubmit}
          defaultValues={nodeData}
        />
        <BaseExecutionNode
          {...props}
          icon={Database}
          name="Postgres Query"
          status={nodeStatus}
          description={description}
          onSettings={handleOpenSettings}
          onDoubleClick={handleOpenSettings}
        />
      </>
    );
  },
);

PostgresQueryNode.displayName = "PostgresQueryNode";
