import { useNodeStatusFromContext } from "@/features/editor/store/node-status-context";

/**
 * Returns the realtime status for a node on the canvas.
 *
 * Previously each node opened its own Inngest subscription (N connections
 * for N nodes).  Now a single `NodeStatusProvider` at the editor level
 * subscribes once per channel type and shares statuses via context.
 * This hook simply reads from that shared context.
 */
export function useNodeStatus({ nodeId }: { nodeId: string }) {
  return useNodeStatusFromContext(nodeId);
}
