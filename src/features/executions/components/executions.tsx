"use client";

import { formatDistanceToNow } from "date-fns";
import {
  GlobeIcon,
  KeyboardIcon,
  PlayIcon,
  TimerIcon,
  WebhookIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { memo } from "react";

import {
  DataTable,
  TableEmpty,
  TableSkeleton,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/components/dashboard/data-table";
import { PageHeader } from "@/components/dashboard/page";
import {
  Panel,
  PanelActions,
  PanelHeader,
  PanelTitle,
} from "@/components/dashboard/panel";
import { StatusPill } from "@/components/dashboard/status-pill";
import {
  EmptyView,
  EntityContainer,
  EntityPagination,
  ErrorView,
} from "@/components/entity-components";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ExecutionStatus } from "@/generated/prisma/browser";

import { useExecutions, useSuspenseExecutions } from "../hooks/use-executions";
import { useExecutionsParams } from "../hooks/use-executions-params";
import { ExecutionStatusPill } from "../lib/status";

const STATUS_OPTIONS = [
  { value: "ALL", label: "All statuses" },
  { value: "RUNNING", label: "Running" },
  { value: "SUCCESS", label: "Success" },
  { value: "FAILED", label: "Failed" },
  { value: "CANCELLED", label: "Cancelled" },
  { value: "TIMED_OUT", label: "Timed out" },
] as const;

const TRIGGER_ICONS: Record<string, React.ReactNode> = {
  MANUAL: <KeyboardIcon className="size-3" />,
  WEBHOOK: <WebhookIcon className="size-3" />,
  SCHEDULE: <TimerIcon className="size-3" />,
  API: <GlobeIcon className="size-3" />,
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

const COLUMNS = 7;

const ExecutionsTableHead = () => (
  <THead>
    <tr>
      <TH>Run</TH>
      <TH>Workflow</TH>
      <TH className="hidden lg:table-cell">Trigger</TH>
      <TH>Status</TH>
      <TH className="hidden md:table-cell">Started</TH>
      <TH align="right" className="hidden sm:table-cell">
        Duration
      </TH>
      <TH align="right">Cost</TH>
    </tr>
  </THead>
);

export const ExecutionsList = () => {
  const executions = useSuspenseExecutions();
  const items = executions.data.items;

  return (
    <DataTable>
      <ExecutionsTableHead />
      <TBody>
        {items.length === 0 ? (
          <TableEmpty colSpan={COLUMNS}>
            <ExecutionsEmpty />
          </TableEmpty>
        ) : (
          items.map((execution) => (
            <ExecutionRow key={execution.id} data={execution} />
          ))
        )}
      </TBody>
    </DataTable>
  );
};

/** Live indicator, shown only while at least one run is still in flight. */
const RunningIndicator = () => {
  const executions = useExecutions();
  const running =
    executions.data?.items.filter((item) => item.status === "RUNNING").length ??
    0;

  if (running === 0) return null;

  return (
    <StatusPill tone="info" title="This list refreshes while runs are active">
      {running} running
    </StatusPill>
  );
};

const ExecutionsStatusFilter = () => {
  const [params, setParams] = useExecutionsParams();

  return (
    <Select
      value={params.status ?? "ALL"}
      onValueChange={(value) =>
        setParams({
          ...params,
          status: value === "ALL" ? null : value,
          page: 1,
        })
      }
    >
      <SelectTrigger
        aria-label="Filter by status"
        className="h-8 w-[150px] border-hairline bg-panel text-xs shadow-none"
      >
        <SelectValue placeholder="All statuses" />
      </SelectTrigger>
      <SelectContent>
        {STATUS_OPTIONS.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            className="text-xs"
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

export const ExecutionsHeader = () => (
  <PageHeader
    title="Executions"
    description="View your workflow execution history"
    actions={<ExecutionsStatusFilter />}
  />
);

export const ExecutionsPagination = () => {
  const executions = useExecutions();
  const [params, setParams] = useExecutionsParams();

  if (!executions.data) return null;

  return (
    <EntityPagination
      disabled={executions.isFetching}
      totalPages={executions.data.totalPages}
      page={executions.data.page}
      onPageChange={(page) => setParams({ ...params, page })}
    />
  );
};

export const ExecutionsContainer = ({
  children,
}: {
  children: React.ReactNode;
}) => (
  <EntityContainer header={<ExecutionsHeader />}>
    <Panel>
      <PanelHeader>
        <PanelTitle hint="Every run started in this workspace, newest first.">
          Run history
        </PanelTitle>
        <PanelActions>
          <RunningIndicator />
        </PanelActions>
      </PanelHeader>
      {children}
      <ExecutionsPagination />
    </Panel>
  </EntityContainer>
);

export const ExecutionsLoading = () => (
  <DataTable>
    <ExecutionsTableHead />
    <TBody>
      <TableSkeleton columns={COLUMNS} />
    </TBody>
  </DataTable>
);

export const ExecutionsError = () => (
  <ErrorView message="Error loading executions" />
);

export const ExecutionsEmpty = () => {
  const router = useRouter();

  return (
    <EmptyView
      icon={PlayIcon}
      title="No runs yet"
      message="Runs appear here the moment a workflow is triggered — by a webhook, a schedule, the API, or you pressing Run."
      onNew={() => router.push("/workflows")}
      actionLabel="Go to workflows"
      secondaryAction={{
        label: "Start from a template",
        onClick: () => router.push("/templates"),
      }}
    />
  );
};

export const ExecutionRow = memo(
  ({
    data,
  }: {
    data: {
      id: string;
      status: ExecutionStatus;
      trigger: string;
      startedAt: Date;
      completedAt: Date | null;
      durationMs: number | null;
      costUsd: number | null;
      workflow: { id: string; name: string };
    };
  }) => {
    const duration = data.durationMs
      ? formatDuration(data.durationMs)
      : data.completedAt
        ? formatDuration(
            new Date(data.completedAt).getTime() -
              new Date(data.startedAt).getTime(),
          )
        : null;

    const cost = formatCost(data.costUsd);
    const triggerIcon = TRIGGER_ICONS[data.trigger] ?? (
      <PlayIcon className="size-3" />
    );

    return (
      <TR href={`/executions/${data.id}`}>
        <TD>
          <Link
            href={`/executions/${data.id}`}
            className="font-mono text-xs text-muted-foreground hover:text-primary"
          >
            {data.id.slice(0, 8)}
          </Link>
        </TD>
        <TD className="max-w-[220px]">
          <Link
            href={`/workflows/${data.workflow.id}`}
            className="block truncate font-medium hover:text-primary hover:underline"
          >
            {data.workflow.name}
          </Link>
        </TD>
        <TD className="hidden lg:table-cell">
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            {triggerIcon}
            {data.trigger}
          </span>
        </TD>
        <TD>
          <ExecutionStatusPill status={data.status} />
        </TD>
        <TD className="hidden text-muted-foreground md:table-cell">
          {formatDistanceToNow(data.startedAt, { addSuffix: true })}
        </TD>
        <TD
          align="right"
          className="hidden font-mono text-muted-foreground tabular-nums sm:table-cell"
        >
          {duration ?? "-"}
        </TD>
        <TD align="right" className="font-mono tabular-nums">
          {cost ?? <span className="text-muted-foreground">-</span>}
        </TD>
      </TR>
    );
  },
);
ExecutionRow.displayName = "ExecutionRow";
