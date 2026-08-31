"use client";

/**
 * Monitoring charts (AF-M7-03).
 *
 * Built on recharts through the shared `ChartContainer`, the same primitives
 * the `/costs` dashboard uses. That is deliberate: the two pages sit next to
 * each other in the nav, and the hand-rolled SVG this replaced had no axes, no
 * gridlines, and a height that grew with the viewport width — a 30-day chart
 * rendered ~420px tall on a wide screen because its only size constraint was
 * the viewBox aspect ratio.
 */

import Link from "next/link";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";

import { STATUS_COLORS } from "../lib/aggregate";
import { formatCount, formatDayLabel } from "../lib/format";
import type { DailyStatusPoint } from "../lib/types";

/**
 * Stack order, bottom to top: the outcome you want, then the ones you don't.
 *
 * `RUNNING` is charted rather than dropped. The previous chart omitted it, so
 * a day whose runs were still in flight rendered as an empty column — the
 * dashboard showed "nothing happened" during exactly the window where
 * something was happening.
 */
const CHARTED_STATUSES = [
  "SUCCESS",
  "RUNNING",
  "FAILED",
  "TIMED_OUT",
  "QUOTA_EXCEEDED",
  "CANCELLED",
] as const;

const STATUS_LABELS: Record<(typeof CHARTED_STATUSES)[number], string> = {
  SUCCESS: "Succeeded",
  RUNNING: "Running",
  FAILED: "Failed",
  TIMED_OUT: "Timed out",
  QUOTA_EXCEEDED: "Quota exceeded",
  CANCELLED: "Cancelled",
};

const chartConfig = Object.fromEntries(
  CHARTED_STATUSES.map((status) => [
    status,
    { label: STATUS_LABELS[status], color: STATUS_COLORS[status] },
  ]),
) satisfies ChartConfig;

export function ExecutionsOverTimeChart({
  data,
  periodDays,
}: {
  data: DailyStatusPoint[];
  periodDays: number;
}) {
  const total = data.reduce(
    (sum, point) =>
      sum + CHARTED_STATUSES.reduce((n, s) => n + (point[s] ?? 0), 0),
    0,
  );

  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle className="text-base">Executions over time</CardTitle>
        <CardDescription>
          Runs per day by outcome across the last {periodDays} days (UTC days).
        </CardDescription>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No executions in this window. Run a workflow and it will appear
            here.
          </p>
        ) : (
          <ChartContainer config={chartConfig} className="h-[240px] w-full">
            <BarChart data={data} margin={{ left: 4, right: 4, top: 4 }}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={24}
                tickFormatter={formatDayLabel}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={40}
                // Runs are whole things; "1.5 executions" is not a reading.
                allowDecimals={false}
                tickFormatter={formatCount}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(label) => formatDayLabel(String(label))}
                  />
                }
              />
              <ChartLegend content={<ChartLegendContent />} />
              {CHARTED_STATUSES.map((status) => (
                <Bar
                  key={status}
                  dataKey={status}
                  stackId="runs"
                  fill={`var(--color-${status})`}
                  // Only the top segment of a stack should be rounded, and
                  // which status that is varies per day, so leave all square.
                  radius={0}
                />
              ))}
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/*  Ranked lists — error breakdown, top failing workflows                     */
/* -------------------------------------------------------------------------- */

/**
 * Share bar. Width is the row's fraction of the largest row, so the top row
 * always fills the track and the rest are read against it. Minimum 2% keeps a
 * single failure visible rather than rendering a zero-width sliver.
 */
const ShareBar = ({ fraction, tone }: { fraction: number; tone: string }) => (
  <div className="h-1.5 w-full rounded-full bg-muted">
    <div
      className="h-1.5 rounded-full"
      style={{
        width: `${Math.max(2, Math.min(100, fraction * 100))}%`,
        backgroundColor: tone,
      }}
    />
  </div>
);

export interface RankedRow {
  key: string;
  label: string;
  value: number;
  /** Rendered under the bar — "last failed 3 hours ago". */
  detail?: string;
  /** Makes the label a link when the row points at something. */
  href?: string;
}

export function RankedListCard({
  title,
  description,
  rows,
  emptyMessage,
  unit,
  tone,
}: {
  title: string;
  description: string;
  rows: RankedRow[];
  emptyMessage: string;
  /** Singular noun for the value — "failure", "error". */
  unit: string;
  tone: string;
}) {
  const max = rows.reduce((m, row) => Math.max(m, row.value), 0);

  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {emptyMessage}
          </p>
        ) : (
          rows.map((row) => (
            <div key={row.key} className="space-y-1">
              <div className="flex items-baseline justify-between gap-3">
                {row.href ? (
                  <Link
                    href={row.href}
                    className="truncate text-sm hover:underline"
                  >
                    {row.label}
                  </Link>
                ) : (
                  <span className="truncate font-mono text-sm">
                    {row.label}
                  </span>
                )}
                <span className="shrink-0 font-mono text-sm tabular-nums">
                  {formatCount(row.value)}
                </span>
              </div>
              <ShareBar fraction={max > 0 ? row.value / max : 0} tone={tone} />
              <p className="text-xs text-muted-foreground">
                {row.value === 1 ? `1 ${unit}` : `${row.value} ${unit}s`}
                {row.detail ? ` · ${row.detail}` : ""}
              </p>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
