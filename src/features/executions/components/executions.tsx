"use client";

import { formatDistanceToNow } from "date-fns";
import {
  BanIcon,
  CheckCircle2Icon,
  ClockIcon,
  GlobeIcon,
  KeyboardIcon,
  Loader2Icon,
  PlayIcon,
  StopCircleIcon,
  TimerIcon,
  WebhookIcon,
  XCircleIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { memo } from "react";
import {
  EmptyView,
  EntityContainer,
  EntityItem,
  EntityList,
  EntityPagination,
  ErrorView,
  LoadingView,
} from "@/components/entity-components";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ExecutionStatus } from "@/generated/prisma/browser";
import { useExecutions, useSuspenseExecutions } from "../hooks/use-executions";
import { useExecutionsParams } from "../hooks/use-executions-params";

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

export const ExecutionsList = () => {
  const executions = useSuspenseExecutions();
  const hasRunning = executions.data.items.some((e) => e.status === "RUNNING");

  return (
    <>
      <EntityList
        items={executions.data.items}
        getKey={(execution) => execution.id}
        renderItem={(execution) => <ExecutionItem data={execution} />}
        emptyView={<ExecutionsEmpty />}
      />
      {hasRunning && (
        <p className="text-xs text-muted-foreground text-center py-1">
          Auto-refreshing while runs are active...
        </p>
      )}
    </>
  );
};

export const ExecutionsHeader = () => {
  const [params, setParams] = useExecutionsParams();
  const executions = useExecutions();
  const hasRunning = executions.data?.items.some((e) => e.status === "RUNNING");

  return (
    <div className="flex flex-row items-center justify-between gap-x-4">
      <div className="flex flex-col">
        <h1 className="text-lg md:text-xl font-semibold">Executions</h1>
        <p className="text-xs md:text-sm text-muted-foreground">
          View your workflow execution history
        </p>
      </div>
      <div className="flex items-center gap-2">
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
          <SelectTrigger className="w-[160px] h-8 text-xs">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {hasRunning && (
          <Loader2Icon className="size-4 animate-spin text-blue-600" />
        )}
      </div>
    </div>
  );
};

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
}) => {
  return (
    <EntityContainer
      header={<ExecutionsHeader />}
      pagination={<ExecutionsPagination />}
    >
      {children}
    </EntityContainer>
  );
};

export const ExecutionsLoading = () => {
  return <LoadingView message="Loading executions..." />;
};

export const ExecutionsError = () => {
  return <ErrorView message="Error loading executions" />;
};

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
    case ExecutionStatus.QUOTA_EXCEEDED:
      return <BanIcon className="size-5 text-red-600" />;
    default:
      return <ClockIcon className="size-5 text-muted-foreground" />;
  }
};

const formatStatus = (status: ExecutionStatus) => {
  return status.charAt(0) + status.slice(1).toLowerCase();
};

export const ExecutionItem = memo(
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
      workflow: {
        id: string;
        name: string;
      };
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

    const subtitle = (
      <span className="flex flex-wrap items-center gap-x-1.5">
        <span className="inline-flex items-center gap-1">
          {triggerIcon}
          {data.trigger}
        </span>
        <span>&bull;</span>
        <span>{data.workflow.name}</span>
        <span>&bull;</span>
        <span>
          Started {formatDistanceToNow(data.startedAt, { addSuffix: true })}
        </span>
        {duration && (
          <>
            <span>&bull;</span>
            <span>{duration}</span>
          </>
        )}
        {cost && (
          <>
            <span>&bull;</span>
            <span className="font-mono">{cost}</span>
          </>
        )}
      </span>
    );

    return (
      <EntityItem
        href={`/executions/${data.id}`}
        title={formatStatus(data.status)}
        subtitle={subtitle}
        image={
          <div className="size-8 flex items-center justify-center">
            {getStatusIcon(data.status)}
          </div>
        }
      />
    );
  },
);
