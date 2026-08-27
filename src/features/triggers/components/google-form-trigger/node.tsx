import type { NodeProps } from "@xyflow/react";
import { memo, useCallback, useState } from "react";
import { useNodeStatus } from "@/features/executions/hooks/use-node-status";
import { BaseTriggerNode } from "../base-trigger-node";
import { GoogleFormTriggerDialog } from "./dialog";

export const GoogleFormTrigger = memo((props: NodeProps) => {
  const [dialogOpen, setDialogOpen] = useState(false);

  const nodeStatus = useNodeStatus({ nodeId: props.id });

  const handleOpenSettings = useCallback(() => setDialogOpen(true), []);

  return (
    <>
      <GoogleFormTriggerDialog open={dialogOpen} onOpenChange={setDialogOpen} />
      <BaseTriggerNode
        {...props}
        icon="/logos/googleform.svg"
        name="Google Form"
        description="When form is submitted"
        status={nodeStatus}
        onSettings={handleOpenSettings}
        onDoubleClick={handleOpenSettings}
      />
    </>
  );
});
