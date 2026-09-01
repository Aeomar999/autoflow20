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

/**
 * Mosaic rendering.
 *
 * The bar height is still the truth; the squares are how it is painted. In a
 * six-way stack, solid segments of adjacent hues (amber on orange, two reds)
 * bleed into one another and a thin sliver disappears entirely. Gapped squares
 * keep every segment separable, and a segment one square tall is still visible.
 *
 * Cells stretch to fill their segment exactly, so nothing is clipped and the
 * stack tiles cleanly from the baseline up. That also means a square is not a
 * fixed number of runs: the axis and the tooltip carry the counts.
 */
const CELL = 7;
const GAP = 1.6;
/** Past this many rows the squares stop being legible and cost DOM for nothing. */
const MAX_ROWS = 26;

type ShapeProps = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fill?: string;
};

const mosaicRects = (
  { x = 0, y = 0, width = 0, height = 0 }: ShapeProps,
  fill: string,
  keyPrefix: string,
) => {
  const cols = Math.max(1, Math.floor(width / CELL));
  const rows = Math.max(1, Math.round(height / CELL));
  const cellW = width / cols;
  const cellH = height / rows;

  const rects: React.ReactNode[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      rects.push(
        <rect
          key={`${keyPrefix}-${row}-${col}`}
          x={x + col * cellW}
          y={y + height - (row + 1) * cellH}
          width={Math.max(1, cellW - GAP)}
          height={Math.max(1, cellH - GAP)}
          rx={1}
          fill={fill}
        />,
      );
    }
  }
  return rects;
};

/** One stacked segment, drawn as squares. */
const MosaicBar = (props: ShapeProps & { fill?: string }) => {
  const { height = 0, width = 0, fill = "currentColor" } = props;
  if (height <= 0 || width <= 0) return null;

  // Tall segments fall back to a solid block rather than emitting hundreds of
  // rects that read as a solid block anyway.
  if (Math.round(height / CELL) > MAX_ROWS) {
    return (
      <rect
        x={props.x}
        y={props.y}
        width={width}
        height={height}
        fill={fill}
        rx={1}
      />
    );
  }

  return <g>{mosaicRects(props, fill, "m")}</g>;
};

const GHOST_PATTERN_ID = "mosaic-ghost";

/**
 * Hover crosshair. Recharts' default bar cursor is a filled slab that hides the
 * column you are pointing at; this marks the day without covering it.
 */
const MosaicCursor = (props: ShapeProps) => {
  const { x = 0, y = 0, width = 0, height = 0 } = props;
  const center = x + width / 2;

  return (
    <g>
      <line
        x1={center}
        x2={center}
        y1={y}
        y2={y + height}
        stroke="var(--primary)"
        strokeWidth={1}
        strokeDasharray="3 3"
      />
      <circle
        cx={center}
        cy={y}
        r={3}
        fill="var(--panel)"
        stroke="var(--primary)"
        strokeWidth={1.5}
      />
    </g>
  );
};

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
              {/* The empty part of each column, so the plot reads as a
                  board the bars fill. Tiled as a pattern rather than per-square
                  rects: a full-height column is ~27 rows, which across 30 days
                  would be four thousand nodes for a 10%-opacity texture.

                  This <defs> has to be a direct child: recharts renders only
                  the SVG children it recognises and drops wrapped ones. */}
              <defs>
                <pattern
                  id={GHOST_PATTERN_ID}
                  width={CELL}
                  height={CELL}
                  patternUnits="userSpaceOnUse"
                >
                  <rect
                    width={CELL - GAP}
                    height={CELL - GAP}
                    rx={1}
                    fill="var(--muted-foreground)"
                    opacity={0.1}
                  />
                </pattern>
              </defs>
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
                axisLine={false}
                width={40}
                tickSize={2}
                // A short round-capped stub reads as a tick dot beside the
                // label rather than a rule running into the plot.
                tickLine={{
                  stroke: "var(--muted-foreground)",
                  strokeWidth: 2,
                  strokeLinecap: "round",
                }}
                // Runs are whole things; "1.5 executions" is not a reading.
                allowDecimals={false}
                tickFormatter={formatCount}
              />
              <ChartTooltip
                cursor={<MosaicCursor />}
                content={
                  <ChartTooltipContent
                    labelFormatter={(label) => formatDayLabel(String(label))}
                  />
                }
              />
              {CHARTED_STATUSES.map((status, index) => (
                <Bar
                  key={status}
                  dataKey={status}
                  stackId="runs"
                  fill={`var(--color-${status})`}
                  shape={<MosaicBar />}
                  // Only the bottom bar paints the empty grid, or six stacked
                  // series would each redraw the same column.
                  background={
                    index === 0
                      ? { fill: `url(#${GHOST_PATTERN_ID})` }
                      : undefined
                  }
                />
              ))}
            </BarChart>
          </ChartContainer>
        </PanelBody>
      )}

      <PanelFooter>
        <span>Runs per day by outcome, one block per segment</span>
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
