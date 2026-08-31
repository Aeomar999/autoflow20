"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import {
  BanIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClockIcon,
  CopyIcon,
  GlobeIcon,
  KeyboardIcon,
  Loader2Icon,
  RefreshCwIcon,
  StopCircleIcon,
  TimerIcon,
  WebhookIcon,
  XCircleIcon,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";
import { Badge } from "@/components/ui/badge";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSuspenseExecution } from "@/features/executions/hooks/use-executions";
import {
  ExecutionStatus,
  type NodeExecution,
  NodeExecutionStatus,
} from "@/generated/prisma/browser";
import { useTRPC } from "@/trpc/client";

const TRIGGER_ICONS: Record<string, React.ReactNode> = {
  MANUAL: <KeyboardIcon className="size-4" />,
  WEBHOOK: <WebhookIcon className="size-4" />,
  SCHEDULE: <TimerIcon className="size-4" />,
  API: <GlobeIcon className="size-4" />,
};

const getStatusIcon = (status: ExecutionStatus) => {
  switch (status) {
    case ExecutionStatus.SUCCESS:
      return <CheckCircle2Icon className="size-5 text-green-600" />;
    case ExecutionStatus.FAILED:
      return <XCircleIcon className="size-5 text-red-600" />;
    case ExecutionStatus.RUNNING:
      return <Loader2Icon className="size-5 text-blue-600 animate-spin" />;
    case ExecutionStatus.CANCELLED:
      return <StopCircleIcon className="size-5 text-orange-500" />;
    case ExecutionStatus.TIMED_OUT:
      return <TimerIcon className="size-5 text-red-600" />;
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
    case NodeExecutionStatus.SKIPPED:
      return <BanIcon className="size-4 shrink-0 text-muted-foreground" />;
    default:
      return <ClockIcon className="size-4 shrink-0 text-muted-foreground" />;
  }
};

const formatNodeStatus = (status: NodeExecutionStatus) => {
  return status.charAt(0) + status.slice(1).toLowerCase();
};

const formatCost = (costUsd: number | null): string | null => {
  if (costUsd === null || costUsd === 0) return null;
  return `$${costUsd.toFixed(4)}`;
};

const formatDuration = (durationMs: number | null): string | null => {
  if (durationMs === null) return null;
  if (durationMs < 1000) return `${durationMs}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
};

const TRUNCATION_MARKER = "... [truncated at 128 KB]";
const isTruncated = (value: unknown): boolean =>
  typeof value === "string" && value.endsWith(TRUNCATION_MARKER);

const CopyButton = ({ text }: { text: string }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [text]);

  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-6 shrink-0"
      onClick={handleCopy}
    >
      <CopyIcon className="size-3" />
      {copied && (
        <span className="text-[10px] text-muted-foreground ml-1">Copied</span>
      )}
    </Button>
  );
};

const JsonViewer = ({ label, data }: { label: string; data: unknown }) => {
  const [search, setSearch] = useState("");
  const truncated = isTruncated(data);
  const raw = truncated ? (data as string) : JSON.stringify(data, null, 2);
  const highlighted =
    search && raw
      ? raw.replace(
          new RegExp(
            `(${search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
            "gi",
          ),
          ">>>$1<<<",
        )
      : raw;

  return (
    <div className="rounded-md border bg-muted/50">
      <div className="flex items-center gap-2 px-3 py-2 border-b">
        <span className="text-xs font-medium">{label}</span>
        {truncated && (
          <span className="text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
            Truncated
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <input
            className="text-[11px] px-1.5 py-0.5 border rounded bg-background w-28"
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <CopyButton text={raw} />
        </div>
      </div>
      <pre className="text-xs font-mono overflow-auto max-h-64 p-3 whitespace-pre-wrap">
        {highlighted}
      </pre>
    </div>
  );
};

export const ExecutionView = ({ executionId }: { executionId: string }) => {
  const { data: execution } = useSuspenseExecution(executionId);
  const [showStackTrace, setShowStackTrace] = useState(false);
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const cancelMutation = useMutation(
    trpc.executions.cancel.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries(
          trpc.executions.getOne.queryOptions({ id: executionId }),
        );
        queryClient.invalidateQueries(trpc.executions.list.queryOptions({}));
      },
    }),
  );

  const retryMutation = useMutation(
    trpc.executions.retry.mutationOptions({
      onSuccess: (newExec: { id: string }) => {
        window.location.href = `/executions/${newExec.id}`;
      },
    }),
  );

  const duration = execution.durationMs
    ? formatDuration(execution.durationMs)
    : execution.completedAt
      ? formatDuration(
          new Date(execution.completedAt).getTime() -
            new Date(execution.startedAt).getTime(),
        )
      : null;

  const cost = formatCost(execution.costUsd);
  // AF-M5-07: hit rate for this run. Nodes with no cache configured record a
  // null cacheHit and are excluded from both halves, so the ratio describes
  // only the nodes that actually asked the cache.
  const cacheableTraces = (execution.nodeExecutions as NodeExecution[]).filter(
    (trace) => trace.cacheHit !== null,
  );
  const cachedTraceCount = cacheableTraces.filter(
    (trace) => trace.cacheHit === true,
  ).length;
  const isRunning = execution.status === ExecutionStatus.RUNNING;
  const isRetryable = ["FAILED", "TIMED_OUT", "CANCELLED"].includes(
    execution.status,
  );

  return (
    <Card className="shadow-none">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {getStatusIcon(execution.status)}
            <div>
              <CardTitle className="flex items-center gap-2">
                {formatStatus(execution.status)}
                {execution.mode === "TEST" && (
                  <Badge variant="outline" className="text-[10px]">
                    TEST
                  </Badge>
                )}
              </CardTitle>
              <CardDescription>
                Execution for {execution.workflow.name}
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isRunning && (
              <Button
                size="sm"
                variant="destructive"
                disabled={cancelMutation.isPending}
                onClick={() => cancelMutation.mutate({ id: executionId })}
              >
                <StopCircleIcon className="size-4 mr-1" />
                Cancel
              </Button>
            )}
            {isRetryable && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={retryMutation.isPending}
                  >
                    <RefreshCwIcon className="size-4 mr-1" />
                    Retry
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() => retryMutation.mutate({ id: executionId })}
                  >
                    Retry from start
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
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
            <p className="text-sm font-medium text-muted-foreground">Trigger</p>
            <p className="text-sm flex items-center gap-1.5">
              {TRIGGER_ICONS[execution.trigger] ?? (
                <KeyboardIcon className="size-4" />
              )}
              {execution.trigger}
            </p>
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">Started</p>
            <p className="text-sm">
              {formatDistanceToNow(execution.startedAt, { addSuffix: true })}
            </p>
          </div>
          {execution.completedAt && (
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
          )}
          {duration && (
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Duration
              </p>
              <p className="text-sm">{duration}</p>
            </div>
          )}
          {cost && (
            <div>
              <p className="text-sm font-medium text-muted-foreground">Cost</p>
              <p className="text-sm font-mono">{cost}</p>
            </div>
          )}
          {execution.tokensIn !== null &&
            execution.tokensIn !== undefined &&
            execution.tokensIn > 0 && (
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Tokens
                </p>
                <p className="text-sm">
                  {execution.tokensIn.toLocaleString()} in /{" "}
                  {execution.tokensOut?.toLocaleString() ?? 0} out
                </p>
              </div>
            )}
          {cacheableTraces.length > 0 && (
            <div>
              <p className="text-sm font-medium text-muted-foreground">Cache</p>
              <p className="text-sm">
                {cachedTraceCount} of {cacheableTraces.length} AI{" "}
                {cacheableTraces.length === 1 ? "node" : "nodes"} served from
                cache
              </p>
            </div>
          )}
          <div>
            <p className="text-sm font-medium text-muted-foreground">
              Event ID
            </p>
            <p className="text-xs font-mono text-muted-foreground truncate">
              {execution.inngestEventId}
            </p>
          </div>
        </div>

        {execution.error && (
          <div className="p-4 bg-red-50 rounded-md space-y-3">
            <div>
              <p className="text-sm font-medium text-red-900 mb-1">Error</p>
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
                  <pre className="text-xs font-mono text-red-800 overflow-auto mt-2 p-2 bg-red-100 max-h-48">
                    {execution.errorStack}
                  </pre>
                </CollapsibleContent>
              </Collapsible>
            )}
          </div>
        )}

        {execution.input && (
          <JsonViewer label="Workflow Input" data={execution.input} />
        )}

        {execution.output && (
          <JsonViewer label="Workflow Output" data={execution.output} />
        )}

        {execution.nodeExecutions && execution.nodeExecutions.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">
              Node traces ({execution.nodeExecutions.length})
            </p>
            <div className="rounded-md border divide-y">
              {(execution.nodeExecutions as NodeExecution[]).map((trace) => (
                <NodeTraceRow
                  key={trace.id}
                  trace={trace}
                  executionId={executionId}
                  isRetryable={isRetryable}
                />
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

const NodeTraceRow = ({
  trace,
  executionId,
  isRetryable,
}: {
  trace: NodeExecution;
  executionId: string;
  isRetryable: boolean;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const trpc = useTRPC();
  const retryFromNodeMutation = useMutation(
    trpc.executions.retryFromNode.mutationOptions({
      onSuccess: (newExec: { id: string }) => {
        window.location.href = `/executions/${newExec.id}`;
      },
    }),
  );

  const hasDetails =
    trace.error || trace.input || trace.output || trace.skipReason;
  const cost = formatCost(trace.costUsd);
  const duration = formatDuration(trace.durationMs);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="flex items-center gap-3 px-4 py-3">
        {nodeStatusIcon(trace.status)}
        <div className="flex-1 min-w-0">
          <span className="text-sm font-mono truncate block">
            {trace.nodeName || trace.nodeType}
          </span>
          {trace.nodeName && trace.nodeName !== trace.nodeType && (
            <span className="text-[11px] text-muted-foreground font-mono">
              {trace.nodeType}
            </span>
          )}
        </div>
        {trace.status === NodeExecutionStatus.SKIPPED && trace.skipReason && (
          <span className="text-[11px] text-muted-foreground italic max-w-[200px] truncate">
            {trace.skipReason}
          </span>
        )}
        {duration && (
          <span className="text-xs text-muted-foreground shrink-0">
            {duration}
          </span>
        )}
        {cost && (
          <span className="text-xs text-muted-foreground font-mono shrink-0">
            {cost}
          </span>
        )}
        {/* AF-M5-07: a cached node bought nothing, so it shows no cost at all.
            The badge is what tells the two zero-cost cases apart. */}
        {trace.cacheHit === true && (
          <span
            className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5 shrink-0"
            title="Served from the workspace response cache — no provider call, no spend"
          >
            Cached
          </span>
        )}
        <span className="text-xs text-muted-foreground shrink-0">
          {formatNodeStatus(trace.status)}
        </span>
        {hasDetails && (
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs shrink-0"
            >
              {isOpen ? (
                <ChevronDownIcon className="size-3" />
              ) : (
                <ChevronRightIcon className="size-3" />
              )}
            </Button>
          </CollapsibleTrigger>
        )}
        {isRetryable && trace.status !== NodeExecutionStatus.SKIPPED && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs shrink-0"
              >
                ...
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                disabled={retryFromNodeMutation.isPending}
                onClick={() =>
                  retryFromNodeMutation.mutate({
                    id: executionId,
                    nodeId: trace.nodeId,
                  })
                }
              >
                Retry from this node
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <CollapsibleContent>
        <div className="px-4 pb-3 space-y-3">
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span>Attempt {trace.attempt}</span>
            {trace.startedAt && (
              <span>
                Started{" "}
                {formatDistanceToNow(new Date(trace.startedAt), {
                  addSuffix: true,
                })}
              </span>
            )}
          </div>
          {trace.error && (
            <div className="p-3 bg-red-50 rounded-sm space-y-1">
              <p className="text-xs font-medium text-red-900">Error</p>
              <pre className="text-xs font-mono text-red-800 overflow-auto whitespace-pre-wrap">
                {trace.error}
              </pre>
            </div>
          )}
          {trace.skipReason && (
            <div className="p-3 bg-muted rounded-sm">
              <p className="text-xs text-muted-foreground">
                Skipped: {trace.skipReason}
              </p>
            </div>
          )}
          {trace.input && <JsonViewer label="Input" data={trace.input} />}
          {trace.output && <JsonViewer label="Output" data={trace.output} />}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};
