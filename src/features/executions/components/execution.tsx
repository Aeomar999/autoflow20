"use client";

import { formatDistanceToNow } from "date-fns";
import {
  CheckCircle2Icon,
  ClockIcon,
  Loader2Icon,
  XCircleIcon,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useSuspenseExecution } from "@/features/executions/hooks/use-executions";
import {
  ExecutionStatus,
  type NodeExecution,
  NodeExecutionStatus,
} from "@/generated/prisma";

const getStatusIcon = (status: ExecutionStatus) => {
  switch (status) {
    case ExecutionStatus.SUCCESS:
      return <CheckCircle2Icon className="size-5 text-green-600" />;
    case ExecutionStatus.FAILED:
      return <XCircleIcon className="size-5 text-red-600" />;
    case ExecutionStatus.RUNNING:
      return <Loader2Icon className="size-5 text-blue-600 animate-spin" />;
    default:
      return <ClockIcon className="size-5 text-muted-foreground" />;
  }
};

const formatStatus = (status: ExecutionStatus) => {
  return status.charAt(0) + status.slice(1).toLowerCase();
};

const nodeStatusIcon = (status: NodeExecutionStatus) => {
  switch (status) {
    case NodeExecutionStatus.SUCCESS:
      return <CheckCircle2Icon className="size-4 shrink-0 text-green-600" />;
    case NodeExecutionStatus.FAILED:
      return <XCircleIcon className="size-4 shrink-0 text-red-600" />;
    case NodeExecutionStatus.RUNNING:
      return (
        <Loader2Icon className="size-4 shrink-0 animate-spin text-blue-600" />
      );
    default:
      return <ClockIcon className="size-4 shrink-0 text-muted-foreground" />;
  }
};

const formatNodeStatus = (status: NodeExecutionStatus) => {
  return status.charAt(0) + status.slice(1).toLowerCase();
};

export const ExecutionView = ({ executionId }: { executionId: string }) => {
  const { data: execution } = useSuspenseExecution(executionId);
  const [showStackTrace, setShowStackTrace] = useState(false);

  const duration = execution.completedAt
    ? Math.round(
        (new Date(execution.completedAt).getTime() -
          new Date(execution.startedAt).getTime()) /
          1000,
      )
    : null;

  return (
    <Card className="shadow-none">
      <CardHeader>
        <div className="flex items-center gap-3">
          {getStatusIcon(execution.status)}
          <div>
            <CardTitle>{formatStatus(execution.status)}</CardTitle>
            <CardDescription>
              Execution for {execution.workflow.name}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm font-medium text-muted-foreground">
              Workflow
            </p>
            <Link
              prefetch
              className="text-sm hover:underline text-primary"
              href={`/workflows/${execution.workflowId}`}
            >
              {execution.workflow.name}
            </Link>
          </div>

          <div>
            <p className="text-sm font-medium text-muted-foreground">Status</p>
            <p className="text-sm">{formatStatus(execution.status)}</p>
          </div>

          <div>
            <p className="text-sm font-medium text-muted-foreground">Started</p>
            <p className="text-sm">
              {formatDistanceToNow(execution.startedAt, { addSuffix: true })}
            </p>
          </div>

          {execution.completedAt ? (
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Completed
              </p>
              <p className="text-sm">
                {formatDistanceToNow(execution.completedAt, {
                  addSuffix: true,
                })}
              </p>
            </div>
          ) : null}

          {duration !== null ? (
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Duration
              </p>
              <p className="text-sm">{duration}s</p>
            </div>
          ) : null}

          <div>
            <p className="text-sm font-medium text-muted-foreground">
              Event ID
            </p>
            <p className="text-sm">{execution.inngestEventId}</p>
          </div>
        </div>
        {execution.error && (
          <div className="mt-6 p-4 bg-red-50 rounded-md space-y-3">
            <div>
              <p className="text-sm font-medium text-red-900 mb-2">Error</p>
              <p className="text-sm text-red-800 font-mono">
                {execution.error}
              </p>
            </div>

            {execution.errorStack && (
              <Collapsible
                open={showStackTrace}
                onOpenChange={setShowStackTrace}
              >
                <CollapsibleTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-900 hover:bg-red-100"
                  >
                    {showStackTrace ? "Hide stack trace" : "Show stack trace"}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <pre className="text-xs font-mono text-red-800 overflow-auto mt-2 p-2 bg-red-100">
                    {execution.errorStack}
                  </pre>
                </CollapsibleContent>
              </Collapsible>
            )}
          </div>
        )}

        {execution.output && (
          <div className="mt-6 p-4 bg-muted rounded-md">
            <p className="text-sm font-medium mb-2">Output</p>
            <pre className="text-xs font-mono overflow-auto">
              {JSON.stringify(execution.output, null, 2)}
            </pre>
          </div>
        )}
        {execution.nodeExecutions && execution.nodeExecutions.length > 0 && (
          <div className="mt-6 space-y-2">
            <p className="text-sm font-medium">Node traces</p>
            <div className="rounded-md border divide-y">
              {(execution.nodeExecutions as NodeExecution[]).map((trace) => (
                <Collapsible key={trace.id}>
                  <div className="flex items-center gap-3 px-4 py-3">
                    {nodeStatusIcon(trace.status)}
                    <span className="text-sm font-mono flex-1 truncate">
                      #{trace.order} {trace.nodeType}
                      <span className="text-muted-foreground ml-2 text-xs">
                        ({trace.nodeId})
                      </span>
                    </span>
                    {trace.durationMs !== null && (
                      <span className="text-xs text-muted-foreground shrink-0">
                        {trace.durationMs}ms
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground shrink-0">
                      {formatNodeStatus(trace.status)}
                    </span>
                    {(trace.error || trace.attempt > 0) && (
                      <CollapsibleTrigger className="text-xs text-primary hover:underline shrink-0">
                        Details
                      </CollapsibleTrigger>
                    )}
                  </div>
                  <CollapsibleContent>
                    <div className="px-4 pb-3 space-y-1">
                      <p className="text-xs text-muted-foreground">
                        Attempt {trace.attempt}
                        {trace.startedAt
                          ? ` - started ${formatDistanceToNow(
                              new Date(trace.startedAt),
                              { addSuffix: true },
                            )}`
                          : ""}
                      </p>
                      {trace.error && (
                        <pre className="text-xs font-mono text-red-700 overflow-auto whitespace-pre-wrap bg-red-50 p-2 rounded-sm">
                          {trace.error}
                        </pre>
                      )}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
