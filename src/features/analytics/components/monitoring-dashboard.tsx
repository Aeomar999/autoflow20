"use client";

/**
 * Monitoring dashboard client component (AF-M7-03).
 *
 * Layout: a stat row, a full-width outcome chart paired with the two panels
 * that qualify it (step latency, monthly quota), then the two ranked failure
 * lists. Every panel is the shared `Panel` shape, so this page and `/costs`
 * read as one instrument rather than two.
 */

import { formatDistanceToNow } from "date-fns";
import {
  ActivityIcon,
  CheckCircle2Icon,
  ClockIcon,
  GaugeIcon,
  TimerIcon,
  XCircleIcon,
} from "lucide-react";
import Link from "next/link";

import {
  DashboardError,
  DashboardLoading,
  DashboardPage,
  Meter,
  PageHeader,
} from "@/components/dashboard/page";
import {
  Panel,
  PanelBody,
  PanelHeader,
  PanelTitle,
} from "@/components/dashboard/panel";
import { RangeSelect } from "@/components/dashboard/range-select";
import {
  halfOverHalfDelta,
  StatCard,
  StatGrid,
} from "@/components/dashboard/stat-card";
import { cn } from "@/lib/utils";

import { useSuspenseMonitoringOverview } from "../hooks/use-monitoring";
import { useMonitoringParams } from "../hooks/use-monitoring-params";
import { formatCount, formatDuration, pluralize } from "../lib/format";
import type { DailyStatusPoint } from "../lib/types";
import { MONITORING_PERIOD_DAYS } from "../params";
import { ExecutionsOverTimeChart, RankedListCard } from "./monitoring-charts";

/** Sum one status across the whole period. */
function totalFor(series: DailyStatusPoint[], status: keyof DailyStatusPoint) {
  return series.reduce((sum, point) => sum + Number(point[status] ?? 0), 0);
}

/** Per-day series for one status, for the stat card sparklines. */
function seriesFor(
  series: DailyStatusPoint[],
  statuses: (keyof DailyStatusPoint)[],
) {
  return series.map((point) =>
    statuses.reduce((sum, status) => sum + Number(point[status] ?? 0), 0),
  );
}

const FAILURE_STATUSES: (keyof DailyStatusPoint)[] = [
  "FAILED",
  "TIMED_OUT",
  "QUOTA_EXCEEDED",
];

const ALL_STATUSES: (keyof DailyStatusPoint)[] = [
  "SUCCESS",
  "RUNNING",
  "FAILED",
  "TIMED_OUT",
  "QUOTA_EXCEEDED",
  "CANCELLED",
];

/**
 * p50 and p95 measure NodeExecution, not Execution, so they are a different
 * population from "Avg run" in the stat row above. They live in their own
 * panel, labelled "step", so the three cannot be read as one distribution.
 */
const StepLatencyPanel = ({
  p50DurationMs,
  p95DurationMs,
}: {
  p50DurationMs: number | null;
  p95DurationMs: number | null;
}) => (
  <Panel>
    <PanelHeader>
      <PanelTitle hint="Percentiles over individual node steps, not whole runs.">
        Step latency
      </PanelTitle>
      <TimerIcon className="size-3.5 text-muted-foreground/60" />
    </PanelHeader>
    <PanelBody className="grid grid-cols-2 gap-4">
      {[
        {
          label: "p50 step",
          value: p50DurationMs,
          detail:
            p50DurationMs == null
              ? "No step has completed yet"
              : "Median single node step",
        },
        {
          label: "p95 step",
          value: p95DurationMs,
          detail:
            p95DurationMs == null
              ? "No step has completed yet"
              : "Slowest 5% of node steps",
        },
      ].map((metric) => (
        <div key={metric.label} className="min-w-0">
          <p className="dash-label text-muted-foreground">{metric.label}</p>
          <p className="mt-2 truncate text-2xl leading-none font-semibold tabular-nums">
            {formatDuration(metric.value)}
          </p>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {metric.detail}
          </p>
        </div>
      ))}
    </PanelBody>
  </Panel>
);

const UsagePanel = ({
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
  const fraction = isUnlimited ? 0 : Math.min(1, current / limit);
  const isNearLimit = !isUnlimited && fraction >= 0.8;
  const isAtLimit = !isUnlimited && current >= limit;

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle hint="Production runs count against the plan quota. Test runs do not.">
          Production runs this month
        </PanelTitle>
        <span className="text-xs text-muted-foreground">
          {plan} plan, resets on the 1st
        </span>
      </PanelHeader>
      <PanelBody className="space-y-3">
        <p className="text-2xl leading-none font-semibold tabular-nums">
          {formatCount(current)}
          <span className="ml-1.5 text-sm font-normal text-muted-foreground">
            {isUnlimited ? "of unlimited" : `of ${formatCount(limit)}`}
          </span>
        </p>

        {isUnlimited ? (
          <p className="text-xs text-muted-foreground">
            This plan has no monthly execution limit.
          </p>
        ) : (
          <>
            <Meter
              fraction={fraction}
              tone={isAtLimit ? "danger" : isNearLimit ? "warning" : "accent"}
            />
            <p
              className={cn(
                "text-xs",
                isAtLimit
                  ? "text-danger"
                  : isNearLimit
                    ? "text-warning"
                    : "text-muted-foreground",
              )}
            >
              {isAtLimit
                ? "Limit reached. Further production runs fail with QUOTA_EXCEEDED until the reset or an upgrade."
                : `${pluralize(remaining ?? 0, "run")} remaining${
                    isNearLimit ? ", approaching the limit" : ""
                  }`}
            </p>
          </>
        )}
      </PanelBody>
    </Panel>
  );
};

export function MonitoringDashboard() {
  const { data } = useSuspenseMonitoringOverview();
  const { overview, executionsOverTime, usage, periodDays } = data;

  // Exact counts from the same series the chart draws, rather than
  // reconstructing them from the rounded success-rate percentage.
  const succeeded = totalFor(executionsOverTime, "SUCCESS");
  const running = totalFor(executionsOverTime, "RUNNING");
  const failed = FAILURE_STATUSES.reduce(
    (sum, status) => sum + totalFor(executionsOverTime, status),
    0,
  );

  const totalSeries = seriesFor(executionsOverTime, ALL_STATUSES);
  const successSeries = seriesFor(executionsOverTime, ["SUCCESS"]);
  const failureSeries = seriesFor(executionsOverTime, FAILURE_STATUSES);

  const hasRuns = overview.totalRuns > 0;

  return (
    <div className="flex flex-col gap-4">
      <StatGrid>
        <StatCard
          label="Total runs"
          value={formatCount(overview.totalRuns)}
          unit="runs"
          icon={<ActivityIcon />}
          spark={totalSeries}
          delta={halfOverHalfDelta(totalSeries)}
          detail={
            running > 0
              ? `${formatCount(running)} still running`
              : "Executions started in this window"
          }
        />
        <StatCard
          label="Success rate"
          value={hasRuns ? `${overview.successRate}%` : "n/a"}
          icon={<CheckCircle2Icon />}
          spark={successSeries}
          detail={
            hasRuns
              ? `${formatCount(succeeded)} succeeded · ${formatCount(failed)} failed`
              : "No runs to measure yet"
          }
        />
        <StatCard
          label="Avg run"
          value={formatDuration(overview.avgDurationMs)}
          icon={<ClockIcon />}
          detail={
            overview.avgDurationMs == null
              ? "No run has finished yet"
              : "Mean end-to-end run time"
          }
        />
        <StatCard
          label="Failed runs"
          value={formatCount(failed)}
          unit={failed === 1 ? "run" : "runs"}
          icon={<XCircleIcon />}
          spark={failureSeries}
          delta={halfOverHalfDelta(failureSeries, { invert: true })}
          detail="Failed, timed out or blocked"
        />
      </StatGrid>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <ExecutionsOverTimeChart
            data={executionsOverTime}
            periodDays={periodDays}
          />
        </div>
        <div className="flex flex-col gap-4">
          <StepLatencyPanel
            p50DurationMs={overview.p50DurationMs}
            p95DurationMs={overview.p95DurationMs}
          />
          <UsagePanel
            current={usage.currentMonthCount}
            limit={usage.planLimit}
            remaining={usage.remaining}
            plan={usage.plan}
          />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <RankedListCard
          title="Errors by node type"
          hint="Which node types are failing most in this window."
          unit="failure"
          tone="var(--danger)"
          emptyMessage="No node has failed in this window."
          rows={data.errorBreakdown.map((row) => ({
            key: row.nodeType,
            label: row.nodeType,
            value: row.count,
          }))}
        />
        <RankedListCard
          title="Top failing workflows"
          hint="Workflows with the most failed or timed-out runs."
          unit="failed run"
          tone="var(--warning)"
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
    <PageHeader
      title="Monitoring"
      description="Execution health across this workspace"
      actions={
        <>
          <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
            <GaugeIcon className="size-3.5" />
            Live workspace data
          </span>
          <RangeSelect
            value={days}
            options={MONITORING_PERIOD_DAYS}
            onChange={setDays}
          />
        </>
      }
    />
  );
};

export const MonitoringContainer = ({
  children,
}: {
  children: React.ReactNode;
}) => (
  /* The header (and its range control) renders outside the Suspense boundary,
     so switching the window keeps the page frame stable instead of collapsing
     the whole view into the fallback. */
  <DashboardPage>
    <MonitoringHeader />
    {children}
  </DashboardPage>
);

export const MonitoringLoading = () => (
  <DashboardLoading message="Loading monitoring data..." />
);

export const MonitoringError = () => (
  <DashboardError message="Error loading monitoring data" />
);
