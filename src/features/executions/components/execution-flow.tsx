"use client";

import {
  BanIcon,
  CheckCircle2Icon,
  ClockIcon,
  Loader2Icon,
  XCircleIcon,
} from "lucide-react";

import {
  Panel,
  PanelBody,
  PanelHeader,
  PanelTitle,
} from "@/components/dashboard/panel";
import { StatusPill } from "@/components/dashboard/status-pill";
import { Progress } from "@/components/ui/progress";
import type { NodeExecutionStatus } from "@/generated/prisma/browser";
import { cn } from "@/lib/utils";

import type { ExecutionFlow } from "../lib/flow";

/**
 * AF-UX-06: live node-to-node run progress. Reuses the existing 3s polling on
 * the execution detail page — `useSuspenseExecution` returns the server-side
 * `flow` field alongside the run, so no new tRPC procedure or transport.
 */

const NODE_STATUS_META: Partial<
  Record<
    NodeExecutionStatus,
    { label: string; tone: "success" | "danger" | "info" | "neutral" }
  >
> = {
  SUCCESS: { label: "Success", tone: "success" },
  FAILED: { label: "Failed", tone: "danger" },
  RUNNING: { label: "Running", tone: "info" },
  WAITING: { label: "Waiting", tone: "info" },
  SKIPPED: { label: "Skipped", tone: "neutral" },
};

const nodeStatusIcon = (status: NodeExecutionStatus) => {
  switch (status) {
    case "SUCCESS":
      return <CheckCircle2Icon />;
    case "FAILED":
      return <XCircleIcon />;
    case "RUNNING":
    case "WAITING":
      return <Loader2Icon className="animate-spin" />;
    case "SKIPPED":
      return <BanIcon />;
    default:
      return <ClockIcon />;
  }
};

/** Precedence of a node's effective status across its trace rows. */
const NODE_STATUS_PRECEDENCE: Record<string, number> = {
  FAILED: 4,
  RUNNING: 3,
  WAITING: 2,
  SUCCESS: 1,
  SKIPPED: 0,
};

interface ExecutionFlowPanelProps {
  flow: ExecutionFlow;
  nodeExecutions: ReadonlyArray<{ nodeId: string | null; status: string }>;
  isRunning: boolean;
}

export function ExecutionFlowPanel({
  flow,
  nodeExecutions,
  isRunning,
}: ExecutionFlowPanelProps) {
  if (flow.total === 0) return null;

  // Effective per-node status: the highest-precedence row for that node wins.
  // A node with no row is pending — labeled "Not run" once the execution is
  // terminal (a cancelled/timed-out run can leave RUNNING work unresolved and
  // its percent freezes below 100 instead of lying).
  const statusByNode = new Map<string, NodeExecutionStatus>();
  for (const trace of nodeExecutions) {
    if (!trace.nodeId) continue;
    const current = statusByNode.get(trace.nodeId);
    const incoming = NODE_STATUS_PRECEDENCE[trace.status] ?? -1;
    if (
      current === undefined ||
      incoming > (NODE_STATUS_PRECEDENCE[current] ?? -1)
    ) {
      statusByNode.set(trace.nodeId, trace.status as NodeExecutionStatus);
    }
  }

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle hint="Live node-to-node progress for this run, in execution order.">
          Run progress
        </PanelTitle>
        <span
          className={cn(
            "text-xs tabular-nums",
            flow.percent >= 100 ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {flow.done} of {flow.total} nodes · {flow.percent}%
        </span>
      </PanelHeader>
      <PanelBody>
        <Progress
          value={flow.percent}
          aria-label={`${flow.percent}% complete`}
          className={cn(flow.percent >= 100 && "bg-primary/20")}
        />
        <ol className="mt-5 flex flex-col">
          {flow.nodes.map((node, index) => {
            const status = statusByNode.get(node.id);
            const meta =
              status !== undefined ? NODE_STATUS_META[status] : undefined;
            const active = status === "RUNNING" || status === "WAITING";
            const skipped = status === "SKIPPED";
            const isLast = index === flow.nodes.length - 1;

            return (
              <li
                key={node.id}
                className={cn(
                  "relative flex items-center gap-3 pb-4 pl-8",
                  !isLast && "border-l border-border/60 ml-4",
                  active && "animate-pulse",
                )}
              >
                {!isLast ? (
                  <span className="absolute -left-[3px] top-0 size-1.5 rounded-full bg-border" />
                ) : null}
                <span className="absolute left-0 flex size-6 items-center justify-center rounded-full border border-border bg-well font-mono text-[11px] text-muted-foreground">
                  {index + 1}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span
                    className={cn(
                      "truncate font-mono text-sm",
                      skipped && "text-muted-foreground",
                    )}
                  >
                    {node.name}
                  </span>
                  <span className="truncate font-mono text-[11px] text-muted-foreground">
                    {node.type}
                  </span>
                </span>
                {status !== undefined ? (
                  <StatusPill
                    tone={meta?.tone ?? "neutral"}
                    icon={nodeStatusIcon(status)}
                  >
                    {meta?.label ?? status}
                  </StatusPill>
                ) : (
                  <StatusPill tone="neutral">
                    {isRunning ? "Pending" : "Not run"}
                  </StatusPill>
                )}
              </li>
            );
          })}
        </ol>
      </PanelBody>
    </Panel>
  );
}
