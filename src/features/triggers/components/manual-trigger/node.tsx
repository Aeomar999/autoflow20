import type { NodeProps } from "@xyflow/react";
import { MousePointerIcon } from "lucide-react";
import { memo, useCallback, useState } from "react";
import { useNodeStatus } from "@/features/executions/hooks/use-node-status";
import { BaseTriggerNode } from "../base-trigger-node";
import { ManualTriggerDialog } from "./dialog";

export const ManualTriggerNode = memo((props: NodeProps) => {
  const [dialogOpen, setDialogOpen] = useState(false);

  const nodeStatus = useNodeStatus({ nodeId: props.id });

  const handleOpenSettings = useCallback(() => setDialogOpen(true), []);

  return (
    <>
      <ManualTriggerDialog open={dialogOpen} onOpenChange={setDialogOpen} />
      <BaseTriggerNode
        {...props}
        icon={MousePointerIcon}
        name="When clicking 'Execute workflow'"
        status={nodeStatus}
        onSettings={handleOpenSettings}
        onDoubleClick={handleOpenSettings}
      />
    </>
  );
});
