"use client";

/**
 * Monitoring dashboard client component (AF-M7-03).
 *
 * Fetches the analytics overview via tRPC and renders hand-rolled SVG charts:
 * - Overview stat cards (total runs, success rate, duration percentiles)
 * - Stacked bar chart (executions over time by status)
 * - Error breakdown by node type
 * - Top failing workflows
 * - Quota usage meter
 */

import {
  ActivityIcon,
  AlertTriangleIcon,
  BarChart3Icon,
  ClockIcon,
  TrendingUpIcon,
} from "lucide-react";
import Link from "next/link";
import { useSuspenseMonitoringOverview } from "../hooks/use-monitoring";
import { useMonitoringParams } from "../hooks/use-monitoring-params";
import { STATUS_COLORS } from "../lib/aggregate";
import { HorizontalBarChart, StackedBarChart } from "./svg-charts";

function formatDuration(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function StatCard({
  label,
  value,
  icon: Icon,
  subtitle,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  subtitle?: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2 text-muted-foreground text-sm">
        <Icon className="h-4 w-4" />
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {subtitle ? (
        <div className="mt-0.5 text-xs text-muted-foreground">{subtitle}</div>
      ) : null}
    </div>
  );
}

function UsageMeter({
  current,
  limit,
  plan,
}: {
  current: number;
  limit: number | null;
  plan: string;
}) {
  const isUnlimited = limit === null;
  const pct = isUnlimited ? 0 : Math.min(100, (current / limit) * 100);
  const isHigh = !isUnlimited && pct >= 80;

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2 text-muted-foreground text-sm">
        <TrendingUpIcon className="h-4 w-4" />
        Monthly Usage
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-2xl font-semibold">{current}</span>
        <span className="text-muted-foreground text-sm">
          {isUnlimited ? "of unlimited" : `of ${limit}`} production runs
        </span>
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{plan} plan</div>
      {!isUnlimited ? (
        <div className="mt-3">
          <div className="h-2 w-full rounded-full bg-secondary">
            <div
              className={`h-2 rounded-full transition-all ${isHigh ? "bg-red-500" : "bg-primary"}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SectionHeader({
  title,
  icon: Icon,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <h3 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
      <Icon className="h-4 w-4" />
      {title}
    </h3>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
      {Object.entries(STATUS_COLORS)
        .filter(([k]) => k !== "RUNNING")
        .map(([status, color]) => (
          <span key={status} className="flex items-center gap-1">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: color }}
            />
            {status.replace("_", " ")}
          </span>
        ))}
    </div>
  );
}

export function MonitoringDashboard() {
  const { days, setDays } = useMonitoringParams();
  const { data } = useSuspenseMonitoringOverview();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Monitoring</h1>
          <p className="text-sm text-muted-foreground">
            Execution metrics for the last {data.periodDays} days
          </p>
        </div>
        <div className="flex items-center gap-2">
          {[7, 14, 30].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              className={`rounded-md px-3 py-1.5 text-sm ${
                days === d
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard
          label="Total Runs"
          value={data.overview.totalRuns.toLocaleString()}
          icon={ActivityIcon}
        />
        <StatCard
          label="Success Rate"
          value={`${data.overview.successRate}%`}
          icon={TrendingUpIcon}
        />
        <StatCard
          label="Avg Duration"
          value={formatDuration(data.overview.avgDurationMs)}
          icon={ClockIcon}
        />
        <StatCard
          label="p50 Duration"
          value={formatDuration(data.overview.p50DurationMs)}
          icon={BarChart3Icon}
        />
        <StatCard
          label="p95 Duration"
          value={formatDuration(data.overview.p95DurationMs)}
          icon={BarChart3Icon}
        />
      </div>

      {/* Executions over time */}
      <div className="rounded-lg border bg-card p-4">
        <SectionHeader title="Executions Over Time" icon={BarChart3Icon} />
        <div className="mt-3">
          <StackedBarChart data={data.executionsOverTime} height={200} />
        </div>
        <div className="mt-3">
          <Legend />
        </div>
      </div>

      {/* Two-column: Error breakdown + Top failing workflows */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border bg-card p-4">
          <SectionHeader
            title="Error Breakdown by Node Type"
            icon={AlertTriangleIcon}
          />
          <div className="mt-3">
            <HorizontalBarChart
              rows={data.errorBreakdown.map((r) => ({
                label: r.nodeType,
                value: r.count,
              }))}
              color="#ef4444"
            />
          </div>
        </div>

        <div className="rounded-lg border bg-card p-4">
          <SectionHeader
            title="Top Failing Workflows"
            icon={AlertTriangleIcon}
          />
          <div className="mt-3">
            <HorizontalBarChart
              rows={data.topFailingWorkflows.map((r) => ({
                label: r.workflowName,
                value: r.failures,
              }))}
              color="#f59e0b"
            />
          </div>
        </div>
      </div>

      {/* Usage meter */}
      <UsageMeter
        current={data.usage.currentMonthCount}
        limit={data.usage.planLimit}
        plan={data.usage.plan}
      />

      {/* Cost capture pending notice */}
      <div className="rounded-lg border border-dashed bg-muted/30 p-4 text-center text-sm text-muted-foreground">
        Cost panels will appear here once AF-M5-02 cost capture is wired into
        the runner.
      </div>

      {/* Quick link to costs */}
      <div className="text-center">
        <Link
          href="/costs"
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          View detailed cost breakdown →
        </Link>
      </div>
    </div>
  );
}
