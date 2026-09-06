"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import {
  BanIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClockIcon,
  CoinsIcon,
  CopyIcon,
  DatabaseZapIcon,
  GlobeIcon,
  HashIcon,
  KeyboardIcon,
  Loader2Icon,
  MoreVerticalIcon,
  RefreshCwIcon,
  StopCircleIcon,
  TimerIcon,
  WebhookIcon,
  XCircleIcon,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";

import { Callout } from "@/components/dashboard/callout";
import {
  DataTable,
  rowActionClassName,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/components/dashboard/data-table";
import { PageHeader } from "@/components/dashboard/page";
import {
  Fact,
  Panel,
  PanelActions,
  PanelBody,
  PanelFacts,
  PanelHeader,
  PanelTitle,
} from "@/components/dashboard/panel";
import { StatCard, StatGrid } from "@/components/dashboard/stat-card";
import { StatusPill } from "@/components/dashboard/status-pill";
import { Button } from "@/components/ui/button";
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
import { Input } from "@/components/ui/input";
import { useSuspenseExecution } from "@/features/executions/hooks/use-executions";
import {
  ExecutionStatus,
  NodeExecutionStatus,
} from "@/generated/prisma/browser";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";
import { EXPENSIVE_COST_SHARE, isExpensiveCostShare } from "../lib/cost-share";
import { ExecutionStatusPill } from "../lib/status";
import { ExecutionFlowPanel } from "./execution-flow";

/** Compatible with the router's output (costUsd is number, not Prisma Decimal). */
type TraceRow = {
  id: string;
  executionId: string;
  nodeId: string;
  nodeName: string;
  nodeType: string;
  typeVersion: number;
  status: NodeExecutionStatus;
  attempt: number;
  order: number;
  input: React.ReactNode;
  output: React.ReactNode;
  error: string | null;
  skipReason: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  durationMs: number | null;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  model: string | null;
  cacheHit: boolean | null;
};

const TRIGGER_ICONS: Record<string, React.ReactNode> = {
  MANUAL: <KeyboardIcon className="size-3.5" />,
  WEBHOOK: <WebhookIcon className="size-3.5" />,
  SCHEDULE: <TimerIcon className="size-3.5" />,
  API: <GlobeIcon className="size-3.5" />,
};

const NODE_STATUS_META: Record<
  string,
  { label: string; tone: "success" | "danger" | "info" | "neutral" }
> = {
  SUCCESS: { label: "Success", tone: "success" },
  FAILED: { label: "Failed", tone: "danger" },
  RUNNING: { label: "Running", tone: "info" },
  SKIPPED: { label: "Skipped", tone: "neutral" },
};

const nodeStatusIcon = (status: NodeExecutionStatus) => {
  switch (status) {
    case NodeExecutionStatus.SUCCESS:
      return <CheckCircle2Icon />;
    case NodeExecutionStatus.FAILED:
      return <XCircleIcon />;
    case NodeExecutionStatus.RUNNING:
      return <Loader2Icon className="animate-spin" />;
    case NodeExecutionStatus.SKIPPED:
      return <BanIcon />;
    default:
      return <ClockIcon />;
  }
};

const NodeStatusPill = ({ status }: { status: NodeExecutionStatus }) => {
  const meta = NODE_STATUS_META[status] ?? {
    label: "Pending",
    tone: "neutral",
  };
  return (
    <StatusPill tone={meta.tone} icon={nodeStatusIcon(status)}>
      {meta.label}
    </StatusPill>
  );
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
      size="sm"
      aria-label="Copy to clipboard"
      className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
      onClick={handleCopy}
    >
      <CopyIcon className="size-3" />
      {copied ? "Copied" : "Copy"}
    </Button>
  );
};

/**
 * JSON payload viewer. The search box marks matches inline rather than
 * filtering lines, because a payload read out of context is worse than a long
 * one: you need the surrounding keys to know what you are looking at.
 */
const JsonViewer = ({
  label,
  data,
  hint,
}: {
  label: string;
  data: unknown;
  hint?: string;
}) => {
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
    <Panel>
      <PanelHeader>
        <PanelTitle hint={hint}>{label}</PanelTitle>
        <PanelActions>
          {truncated ? <StatusPill tone="warning">Truncated</StatusPill> : null}
          <Input
            className="h-7 w-32 border-hairline bg-well text-xs shadow-none"
            placeholder="Find in payload"
            aria-label={`Search ${label}`}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <CopyButton text={raw} />
        </PanelActions>
      </PanelHeader>
      <pre className="max-h-72 overflow-auto bg-well p-4 font-mono text-xs whitespace-pre-wrap">
        {highlighted}
      </pre>
    </Panel>
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
  const cacheableTraces = (execution.nodeExecutions as TraceRow[]).filter(
    (trace) => trace.cacheHit !== null,
  );
  const cachedTraceCount = cacheableTraces.filter(
    (trace) => trace.cacheHit === true,
  ).length;
  const isRunning = execution.status === ExecutionStatus.RUNNING;
  const isRetryable = ["FAILED", "TIMED_OUT", "CANCELLED"].includes(
    execution.status,
  );
  const tokensIn = execution.tokensIn ?? 0;
  const tokensOut = execution.tokensOut ?? 0;
  const traces = (execution.nodeExecutions ?? []) as TraceRow[];

  // AF-UX-02: the run's total node cost is the sum of its traces, so a cached
  // hit (records $0) can never push a run into "expensive" territory.
  const totalCost = traces.reduce((sum, trace) => sum + trace.costUsd, 0);
  const showTokens = traces.some(
    (trace) => trace.tokensIn > 0 || trace.tokensOut > 0,
  );
  const anyExpensiveTrace = traces.some((trace) =>
    isExpensiveCostShare(trace.costUsd, totalCost),
  );

  return (
    <>
      <PageHeader
        backTo={{ href: "/executions", label: "Executions" }}
        title={execution.workflow.name}
        badge={
          <>
            <ExecutionStatusPill status={execution.status} />
            {execution.mode === "TEST" ? (
              <StatusPill tone="neutral">Test run</StatusPill>
            ) : null}
          </>
        }
        description={<span className="font-mono text-xs">{execution.id}</span>}
        actions={
          <>
            {isRunning && (
              <Button
                size="sm"
                variant="destructive"
                disabled={cancelMutation.isPending}
                onClick={() => cancelMutation.mutate({ id: executionId })}
              >
                <StopCircleIcon className="size-4" />
                Cancel run
              </Button>
            )}
            {isRetryable && (
              <Button
                size="sm"
                variant="outline"
                className="border-hairline bg-panel"
                disabled={retryMutation.isPending}
                onClick={() => retryMutation.mutate({ id: executionId })}
              >
                <RefreshCwIcon
                  className={cn(
                    "size-4",
                    retryMutation.isPending && "animate-spin",
                  )}
                />
                Retry from start
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="border-hairline bg-panel"
              asChild
            >
              <Link href={`/workflows/${execution.workflowId}`} prefetch>
                Open workflow
              </Link>
            </Button>
          </>
        }
      />

      <StatGrid>
        <StatCard
          label="Duration"
          value={duration ?? "n/a"}
          icon={<ClockIcon />}
          detail={
            duration
              ? "End to end, trigger to finish"
              : "This run has not finished yet"
          }
        />
        <StatCard
          label="Cost"
          value={cost ?? "$0.00"}
          icon={<CoinsIcon />}
          detail={cost ? "Provider spend on this run" : "No AI node billed"}
        />
        <StatCard
          label="Tokens"
          value={(tokensIn + tokensOut).toLocaleString()}
          icon={<HashIcon />}
          detail={`${tokensIn.toLocaleString()} in / ${tokensOut.toLocaleString()} out`}
        />
        <StatCard
          label="Cache"
          value={
            cacheableTraces.length > 0
              ? `${cachedTraceCount}/${cacheableTraces.length}`
              : "n/a"
          }
          icon={<DatabaseZapIcon />}
          detail={
            cacheableTraces.length > 0
              ? "AI nodes served from cache"
              : "No cacheable AI node ran"
          }
        />
      </StatGrid>

      <ExecutionFlowPanel
        flow={execution.flow}
        nodeExecutions={execution.nodeExecutions}
        isRunning={isRunning}
      />

      {execution.error && (
        <Callout tone="danger" title="This run failed">
          <p className="font-mono text-xs break-words">{execution.error}</p>
          {execution.errorStack && (
            <Collapsible
              open={showStackTrace}
              onOpenChange={setShowStackTrace}
              className="mt-2"
            >
              <CollapsibleTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 border-danger/30 bg-transparent px-2 text-xs text-danger hover:bg-danger/10 hover:text-danger"
                >
                  {showStackTrace ? "Hide stack trace" : "Show stack trace"}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-danger/8 p-3 font-mono text-xs whitespace-pre-wrap text-foreground/80">
                  {execution.errorStack}
                </pre>
              </CollapsibleContent>
            </Collapsible>
          )}
        </Callout>
      )}

      <Panel>
        <PanelHeader>
          <PanelTitle hint="Where this run came from and what it was tied to.">
            Run details
          </PanelTitle>
        </PanelHeader>
        <PanelBody>
          <PanelFacts>
            <Fact label="Workflow">
              <Link
                prefetch
                className="text-primary hover:underline"
                href={`/workflows/${execution.workflowId}`}
              >
                {execution.workflow.name}
              </Link>
            </Fact>
            <Fact label="Trigger">
              <span className="inline-flex items-center gap-1.5">
                {TRIGGER_ICONS[execution.trigger] ?? (
                  <KeyboardIcon className="size-3.5" />
                )}
                {execution.trigger}
              </span>
            </Fact>
            <Fact label="Started">
              {formatDistanceToNow(execution.startedAt, { addSuffix: true })}
            </Fact>
            <Fact label="Completed">
              {execution.completedAt
                ? formatDistanceToNow(execution.completedAt, {
                    addSuffix: true,
                  })
                : "Still running"}
            </Fact>
            <Fact label="Node steps">{traces.length.toLocaleString()}</Fact>
            <Fact label="Event ID">
              <span className="font-mono text-xs text-muted-foreground">
                {execution.inngestEventId}
              </span>
            </Fact>
          </PanelFacts>
        </PanelBody>
      </Panel>

      {execution.input ? (
        <JsonViewer
          label="Workflow input"
          data={execution.input}
          hint="The payload the trigger handed to the first node."
        />
      ) : null}

      {execution.output ? (
        <JsonViewer
          label="Workflow output"
          data={execution.output}
          hint="What the last node returned when the run finished."
        />
      ) : null}

      {traces.length > 0 && (
        <Panel>
          <PanelHeader>
            <PanelTitle hint="One row per node attempt, in execution order. Expand a row for its payloads.">
              Node traces
            </PanelTitle>
            <span className="text-xs text-muted-foreground tabular-nums">
              {traces.length} {traces.length === 1 ? "step" : "steps"}
            </span>
            {anyExpensiveTrace ? (
              <StatusPill
                tone="warning"
                title="Amber cost = more than 10% of this run's total spend"
              >
                &gt;{Math.round(EXPENSIVE_COST_SHARE * 100)}% of spend
              </StatusPill>
            ) : null}
          </PanelHeader>
          <DataTable>
            <THead>
              <tr>
                <TH className="w-8">
                  <span className="sr-only">Expand</span>
                </TH>
                <TH>Node</TH>
                <TH>Status</TH>
                <TH align="right" className="hidden lg:table-cell">
                  Attempt
                </TH>
                <TH align="right" className="hidden sm:table-cell">
                  Duration
                </TH>
                {showTokens ? (
                  <TH
                    align="right"
                    className="hidden sm:table-cell"
                    title="Input / output tokens for this node"
                  >
                    Tokens
                  </TH>
                ) : null}
                <TH align="right">Cost</TH>
                <TH align="right">
                  <span className="sr-only">Actions</span>
                </TH>
              </tr>
            </THead>
            <TBody>
              {traces.map((trace) => (
                <NodeTraceRow
                  key={trace.id}
                  trace={trace}
                  executionId={executionId}
                  isRetryable={isRetryable}
                  totalCost={totalCost}
                  showTokens={showTokens}
                />
              ))}
            </TBody>
          </DataTable>
        </Panel>
      )}
    </>
  );
};

const TRACE_COLUMNS = 7;

const NodeTraceRow = ({
  trace,
  executionId,
  isRetryable,
  totalCost,
  showTokens,
}: {
  trace: TraceRow;
  executionId: string;
  isRetryable: boolean;
  totalCost: number;
  showTokens: boolean;
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

  const hasDetails = Boolean(
    trace.error || trace.input || trace.output || trace.skipReason,
  );
  const cost = formatCost(trace.costUsd);
  const duration = formatDuration(trace.durationMs);
  // AF-UX-02: highlight nodes above 10% of the run's total spend.
  const expensive = isExpensiveCostShare(trace.costUsd, totalCost);
  const spendShare =
    expensive && totalCost > 0
      ? `${Math.round((trace.costUsd / totalCost) * 100)}% of this run's spend`
      : undefined;

  return (
    <>
      <TR
        className={cn(
          hasDetails && "cursor-pointer hover:bg-well",
          isOpen && "bg-well",
        )}
        onClick={
          hasDetails
            ? (event) => {
                if ((event.target as HTMLElement).closest("button,a")) return;
                setIsOpen((open) => !open);
              }
            : undefined
        }
      >
        <TD>
          {hasDetails ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-expanded={isOpen}
              aria-label={isOpen ? "Collapse payloads" : "Expand payloads"}
              className="size-6 text-muted-foreground hover:text-foreground"
              onClick={() => setIsOpen((open) => !open)}
            >
              {isOpen ? (
                <ChevronDownIcon className="size-3.5" />
              ) : (
                <ChevronRightIcon className="size-3.5" />
              )}
            </Button>
          ) : null}
        </TD>
        <TD className="max-w-[280px]">
          <span className="block truncate font-mono text-sm">
            {trace.nodeName || trace.nodeType}
          </span>
          {trace.nodeName && trace.nodeName !== trace.nodeType ? (
            <span className="block truncate font-mono text-[11px] text-muted-foreground">
              {trace.nodeType}
            </span>
          ) : null}
        </TD>
        <TD>
          <div className="flex flex-wrap items-center gap-1.5">
            <NodeStatusPill status={trace.status} />
            {/* AF-M5-07: a cached node bought nothing, so it shows no cost at
                all. The pill is what tells the two zero-cost cases apart. */}
            {trace.cacheHit === true ? (
              <StatusPill
                tone="info"
                title="Served from the workspace response cache, so no provider call and no spend"
              >
                Cached
              </StatusPill>
            ) : null}
          </div>
          {trace.status === NodeExecutionStatus.SKIPPED && trace.skipReason ? (
            <p className="mt-1 max-w-[220px] truncate text-xs text-muted-foreground">
              {trace.skipReason}
            </p>
          ) : null}
        </TD>
        <TD
          align="right"
          className="hidden font-mono text-muted-foreground tabular-nums lg:table-cell"
        >
          {trace.attempt}
        </TD>
        <TD
          align="right"
          className="hidden font-mono text-muted-foreground tabular-nums sm:table-cell"
        >
          {duration ?? "-"}
        </TD>
        {showTokens ? (
          <TD
            align="right"
            className="hidden font-mono text-muted-foreground tabular-nums sm:table-cell"
            title={`${trace.tokensIn.toLocaleString()} in / ${trace.tokensOut.toLocaleString()} out`}
          >
            {trace.tokensIn > 0 || trace.tokensOut > 0
              ? `${trace.tokensIn.toLocaleString()} / ${trace.tokensOut.toLocaleString()}`
              : "-"}
          </TD>
        ) : null}
        <TD
          align="right"
          className={cn(
            "font-mono tabular-nums",
            expensive && "font-medium text-warning",
          )}
        >
          {cost !== null ? (
            <span title={spendShare}>{cost}</span>
          ) : (
            <span className="text-muted-foreground">-</span>
          )}
        </TD>
        <TD align="right">
          {isRetryable && trace.status !== NodeExecutionStatus.SKIPPED ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Actions for ${trace.nodeName || trace.nodeType}`}
                  className={rowActionClassName}
                >
                  <MoreVerticalIcon className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  className="gap-2"
                  disabled={retryFromNodeMutation.isPending}
                  onClick={() =>
                    retryFromNodeMutation.mutate({
                      id: executionId,
                      nodeId: trace.nodeId,
                    })
                  }
                >
                  <RefreshCwIcon className="size-4" />
                  Retry from this node
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </TD>
      </TR>

      {isOpen && hasDetails ? (
        <tr className="border-b border-hairline bg-well">
          <td
            colSpan={TRACE_COLUMNS + (showTokens ? 1 : 0)}
            className="px-4 pt-1 pb-4"
          >
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Attempt {trace.attempt}
                {trace.startedAt
                  ? `, started ${formatDistanceToNow(
                      new Date(trace.startedAt),
                      {
                        addSuffix: true,
                      },
                    )}`
                  : ""}
              </p>

              {trace.error ? (
                <Callout tone="danger" title="Node error">
                  <pre className="overflow-auto font-mono text-xs whitespace-pre-wrap">
                    {trace.error}
                  </pre>
                </Callout>
              ) : null}

              {trace.skipReason ? (
                <Callout tone="info" title="Skipped">
                  {trace.skipReason}
                </Callout>
              ) : null}

              {trace.input ? (
                <JsonViewer label="Input" data={trace.input} />
              ) : null}
              {trace.output ? (
                <JsonViewer label="Output" data={trace.output} />
              ) : null}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
};
