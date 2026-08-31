"use client";

/**
 * Monitoring dashboard client component (AF-M7-03).
 *
 * Layout note: this page renders inside `EntityContainer`, like every other
 * dashboard page. It previously did not, so it had no page padding and no
 * `max-w-screen-xl` — on a wide screen the stat row and the range control ran
 * past the viewport edge, and the chart, sized only by its viewBox aspect
 * ratio, grew taller the wider the window got.
 */

import { formatDistanceToNow } from "date-fns";
import {
  ActivityIcon,
  CheckCircle2Icon,
  ClockIcon,
  GaugeIcon,
  TimerIcon,
} from "lucide-react";
import Link from "next/link";

import {
  EntityContainer,
  ErrorView,
  LoadingView,
} from "@/components/entity-components";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

import { useSuspenseMonitoringOverview } from "../hooks/use-monitoring";
import { useMonitoringParams } from "../hooks/use-monitoring-params";
import { formatCount, formatDuration, pluralize } from "../lib/format";
import type { DailyStatusPoint } from "../lib/types";
import { MONITORING_PERIOD_DAYS } from "../params";
import { ExecutionsOverTimeChart, RankedListCard } from "./monitoring-charts";

const Metric = ({
  icon,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
}) => (
  <Card className="shadow-none">
    <CardContent className="p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{detail}</p>
    </CardContent>
  </Card>
);

/** Sum one status across the whole period. */
function totalFor(series: DailyStatusPoint[], status: keyof DailyStatusPoint) {
  return series.reduce((sum, point) => sum + Number(point[status] ?? 0), 0);
}

const UsageMeter = ({
  current,
  limit,
  remaining,
  plan,
}: {
  current: number;
  limit: number | null;
  remaining: number | null;
  plan: string;
}) => {
  const isUnlimited = limit === null;
  const pct = isUnlimited ? 0 : Math.min(100, (current / limit) * 100);
  const isNearLimit = !isUnlimited && pct >= 80;
  const isAtLimit = !isUnlimited && current >= limit;

  return (
    <Card className="shadow-none">
      <CardContent className="p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <div className="flex items-center gap-2 text-muted-foreground">
            <GaugeIcon className="size-3.5" />
            <span className="text-xs font-medium">
              Production runs this month
            </span>
          </div>
          <span className="text-xs text-muted-foreground">
            {plan} plan · resets on the 1st
          </span>
        </div>

        <p className="mt-2 text-2xl font-semibold tabular-nums">
          {formatCount(current)}
          <span className="ml-1 text-sm font-normal text-muted-foreground">
            {isUnlimited ? "of unlimited" : `of ${formatCount(limit)}`}
          </span>
        </p>

        {isUnlimited ? (
          <p className="text-xs text-muted-foreground">
            This plan has no monthly execution limit.
          </p>
        ) : (
          <>
            <div className="mt-3 h-2 w-full rounded-full bg-muted">
              <div
                className={cn(
                  "h-2 rounded-full transition-all",
                  isAtLimit
                    ? "bg-destructive"
                    : isNearLimit
                      ? "bg-amber-500"
                      : "bg-primary",
                )}
                style={{ width: `${Math.max(1, pct)}%` }}
              />
            </div>
            <p
              className={cn(
                "mt-2 text-xs",
                isAtLimit
                  ? "text-destructive"
                  : isNearLimit
                    ? "text-amber-600"
                    : "text-muted-foreground",
              )}
            >
              {isAtLimit
                ? "Limit reached — further production runs fail with QUOTA_EXCEEDED until the reset or an upgrade."
                : `${pluralize(remaining ?? 0, "run")} remaining${isNearLimit ? " — approaching the limit" : ""}`}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export function MonitoringDashboard() {
  const { data } = useSuspenseMonitoringOverview();
  const { overview, executionsOverTime, usage, periodDays } = data;

  // Exact counts from the same series the chart draws, rather than
  // reconstructing them from the rounded success-rate percentage.
  const succeeded = totalFor(executionsOverTime, "SUCCESS");
  const running = totalFor(executionsOverTime, "RUNNING");
  const failed =
    totalFor(executionsOverTime, "FAILED") +
    totalFor(executionsOverTime, "TIMED_OUT") +
    totalFor(executionsOverTime, "QUOTA_EXCEEDED");

  const hasRuns = overview.totalRuns > 0;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <Metric
          icon={<ActivityIcon className="size-3.5" />}
          label="Total runs"
          value={formatCount(overview.totalRuns)}
          detail={
            running > 0
              ? `${formatCount(running)} still running`
              : "Executions started in this window"
          }
        />
        <Metric
          icon={<CheckCircle2Icon className="size-3.5" />}
          label="Success rate"
          value={hasRuns ? `${overview.successRate}%` : "—"}
          detail={
            hasRuns
              ? `${formatCount(succeeded)} succeeded · ${formatCount(failed)} failed`
              : "No runs to measure yet"
          }
        />
        <Metric
          icon={<ClockIcon className="size-3.5" />}
          label="Avg run"
          value={formatDuration(overview.avgDurationMs)}
          detail={
            overview.avgDurationMs == null
              ? "No run has finished yet"
              : "Mean end-to-end run time"
          }
        />
        {/* p50/p95 measure NodeExecution, not Execution — a different
            population from "Avg run" above. The labels say "step" so three
            cards in a row cannot be read as one distribution. */}
        <Metric
          icon={<TimerIcon className="size-3.5" />}
          label="p50 step"
          value={formatDuration(overview.p50DurationMs)}
          detail={
            overview.p50DurationMs == null
              ? "No step has completed yet"
              : "Median single node step"
          }
        />
        <Metric
          icon={<TimerIcon className="size-3.5" />}
          label="p95 step"
          value={formatDuration(overview.p95DurationMs)}
          detail={
            overview.p95DurationMs == null
              ? "No step has completed yet"
              : "Slowest 5% of node steps"
          }
        />
      </div>

      <ExecutionsOverTimeChart
        data={executionsOverTime}
        periodDays={periodDays}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <RankedListCard
          title="Errors by node type"
          description="Which node types are failing most in this window."
          unit="failure"
          tone="var(--destructive)"
          emptyMessage="No node has failed in this window."
          rows={data.errorBreakdown.map((row) => ({
            key: row.nodeType,
            label: row.nodeType,
            value: row.count,
          }))}
        />
        <RankedListCard
          title="Top failing workflows"
          description="Workflows with the most failed or timed-out runs."
          unit="failed run"
          tone="var(--color-amber-500, #f59e0b)"
          emptyMessage="No workflow has failed in this window."
          rows={data.topFailingWorkflows.map((row) => ({
            key: row.workflowId,
            label: row.workflowName,
            value: row.failures,
            href: `/workflows/${row.workflowId}`,
            detail: row.lastFailureAt
              ? `last ${formatDistanceToNow(new Date(row.lastFailureAt), {
                  addSuffix: true,
                })}`
              : undefined,
          }))}
        />
      </div>

      <UsageMeter
        current={usage.currentMonthCount}
        limit={usage.planLimit}
        remaining={usage.remaining}
        plan={usage.plan}
      />

      <p className="text-center text-sm text-muted-foreground">
        Looking for AI spend?{" "}
        <Link
          href="/costs"
          className="text-primary underline-offset-4 hover:underline"
        >
          See the cost breakdown
        </Link>
        .
      </p>
    </div>
  );
}

export const MonitoringHeader = () => {
  const { days, setDays } = useMonitoringParams();

  return (
    <div className="flex flex-row items-center justify-between gap-x-4">
      <div className="flex flex-col">
        <h1 className="text-lg md:text-xl font-semibold">Monitoring</h1>
        <p className="text-xs md:text-sm text-muted-foreground">
          Execution health across this workspace
        </p>
      </div>
      <Select
        value={String(days)}
        onValueChange={(value) => setDays(Number(value))}
      >
        <SelectTrigger className="w-[140px] h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {MONITORING_PERIOD_DAYS.map((option) => (
            <SelectItem key={option} value={String(option)}>
              Last {option} days
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};

export const MonitoringContainer = ({
  children,
}: {
  children: React.ReactNode;
}) => (
  <EntityContainer header={<MonitoringHeader />}>{children}</EntityContainer>
);

export const MonitoringLoading = () => (
  <LoadingView message="Loading monitoring data..." />
);

export const MonitoringError = () => (
  <ErrorView message="Error loading monitoring data" />
);
