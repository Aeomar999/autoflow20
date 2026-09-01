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
        stroke="#f97316"
        strokeWidth={1}
        strokeDasharray="3 3"
      />
      <circle
        cx={center}
        cy={y}
        r={4}
        fill="#1a1c23"
        stroke="#f97316"
        strokeWidth={2}
      />
    </g>
  );
};

import { InfoIcon } from "lucide-react";

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

  const chartData = data.map((point) => {
    const successful = (point.SUCCESS ?? 0);
    const failed = (point.FAILED ?? 0) + (point.TIMED_OUT ?? 0) + (point.QUOTA_EXCEEDED ?? 0) + (point.CANCELLED ?? 0) + (point.RUNNING ?? 0);
    return {
      ...point,
      successful,
      failed,
    };
  });

  const customConfig = {
    successful: { label: "Successful", color: "#f97316" },
    failed: { label: "Failed / Other", color: "#4b5563" },
  } satisfies ChartConfig;

  return (
    <div className="flex flex-col bg-[#1a1c23] border border-white/5 rounded-xl overflow-hidden text-white w-full h-full shadow-lg">
      <div className="p-5 pb-0 flex flex-col gap-6">
        <div className="flex justify-between items-start">
          <div>
            <div className="flex items-center gap-1.5 text-[11px] font-semibold tracking-widest text-white/40 uppercase mb-4">
              EXECUTIONS TREND <InfoIcon className="w-3.5 h-3.5" />
            </div>
            <div className="flex items-baseline gap-2 text-white/60 text-sm mb-1">
              Total Executions : <span className="text-white text-3xl font-semibold tracking-tight">{formatCount(total)}</span>
            </div>
          </div>
          
          <div className="flex gap-4 text-[10px] font-semibold uppercase tracking-wider text-white/50 pt-2">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-[#f97316]"></div>
              SUCCESSFUL
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-[#4b5563]"></div>
              FAILED / OTHER
            </div>
          </div>
        </div>
      </div>

      <div className="p-5 pt-2">
        <ChartContainer config={customConfig} className="h-[280px] w-full">
          <BarChart data={chartData} margin={{ left: 4, right: 4, top: 20 }}>
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
                  fill="#ffffff"
                  opacity={0.03}
                />
              </pattern>
            </defs>
            <CartesianGrid vertical={false} strokeDasharray="2 4" stroke="#ffffff" strokeOpacity={0.05} />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={12}
              minTickGap={24}
              tickFormatter={formatDayLabel}
              stroke="#ffffff"
              strokeOpacity={0.3}
              fontSize={10}
              fontWeight={500}
            />
            <YAxis
              axisLine={false}
              width={40}
              tickSize={2}
              tickLine={{
                stroke: "rgba(255,255,255,0.1)",
                strokeWidth: 2,
                strokeLinecap: "round",
              }}
              allowDecimals={false}
              tickFormatter={formatCount}
              stroke="#ffffff"
              strokeOpacity={0.3}
              fontSize={10}
              fontWeight={500}
            />
            <ChartTooltip
              cursor={<MosaicCursor />}
              content={
                <ChartTooltipContent
                  className="bg-[#2a2c35] border-white/10 text-white rounded-lg shadow-xl"
                  labelFormatter={(label) => formatDayLabel(String(label))}
                />
              }
            />
            
            <Bar
              dataKey="successful"
              stackId="runs"
              fill="#f97316"
              shape={<MosaicBar />}
              background={{ fill: `url(#${GHOST_PATTERN_ID})` }}
            />
            <Bar
              dataKey="failed"
              stackId="runs"
              fill="#4b5563"
              shape={<MosaicBar />}
            />
          </BarChart>
        </ChartContainer>
      </div>
    </div>
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
