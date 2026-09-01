"use client";

/**
 * Monitoring charts (AF-M7-03).
 *
 * Built on recharts through the shared `ChartContainer`, the same primitives
 * the `/costs` dashboard uses. That is deliberate: the two pages sit next to
 * each other in the nav, and the hand-rolled SVG this replaced had no axes, no
 * gridlines, and a height that grew with the viewport width.
 */

import Link from "next/link";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
  Panel,
  PanelBody,
  PanelEmpty,
  PanelFooter,
  PanelHeader,
  PanelTitle,
} from "@/components/dashboard/panel";
import {
  type ChartConfig,
  ChartContainer,
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
 * a day whose runs were still in flight rendered as an empty column.
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
    <Panel>
      <PanelHeader>
        <PanelTitle hint="Runs are bucketed by the UTC day they started, and stacked by their final outcome.">
          Executions over time
        </PanelTitle>
      </PanelHeader>

      {total === 0 ? (
        <PanelEmpty>
          No executions in this window. Run a workflow and it will appear here.
        </PanelEmpty>
      ) : (
        <PanelBody className="space-y-4 pb-2">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <p className="flex items-baseline gap-2">
              <span className="text-sm text-muted-foreground">Total runs</span>
              <span className="text-xl font-semibold tabular-nums">
                {formatCount(total)}
              </span>
            </p>
            <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              {CHARTED_STATUSES.map((status) => (
                <li
                  key={status}
                  className="dash-label flex items-center gap-1.5 text-muted-foreground"
                >
                  <span
                    aria-hidden
                    className="size-1.5 rounded-full"
                    style={{ backgroundColor: STATUS_COLORS[status] }}
                  />
                  {STATUS_LABELS[status]}
                </li>
              ))}
            </ul>
          </div>
          <ChartContainer config={chartConfig} className="h-[248px] w-full">
            <BarChart data={data} margin={{ left: 4, right: 4, top: 4 }}>
              <CartesianGrid vertical={false} strokeDasharray="2 4" />
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
        </PanelBody>
      )}

      <PanelFooter>
        <span>Runs per day by outcome</span>
        <span className="tabular-nums">Last {periodDays} days, UTC</span>
      </PanelFooter>
    </Panel>
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
  <div className="h-1 w-full overflow-hidden rounded-full bg-well">
    <div
      className="h-1 rounded-full"
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
  /** Rendered under the bar, e.g. "last failed 3 hours ago". */
  detail?: string;
  /** Makes the label a link when the row points at something. */
  href?: string;
}

export function RankedListCard({
  title,
  hint,
  rows,
  emptyMessage,
  unit,
  tone,
}: {
  title: string;
  hint: string;
  rows: RankedRow[];
  emptyMessage: string;
  /** Singular noun for the value, e.g. "failure". */
  unit: string;
  tone: string;
}) {
  const max = rows.reduce((m, row) => Math.max(m, row.value), 0);

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle hint={hint}>{title}</PanelTitle>
        {rows.length > 0 ? (
          <span className="text-xs text-muted-foreground tabular-nums">
            {rows.length} shown
          </span>
        ) : null}
      </PanelHeader>

      {rows.length === 0 ? (
        <PanelEmpty>{emptyMessage}</PanelEmpty>
      ) : (
        <PanelBody className="space-y-3.5">
          {rows.map((row) => (
            <div key={row.key} className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-3">
                {row.href ? (
                  <Link
                    href={row.href}
                    className="truncate text-sm hover:text-primary hover:underline"
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
          ))}
        </PanelBody>
      )}
    </Panel>
  );
}
