"use client";

/**
 * Hand-rolled SVG chart primitives for the monitoring dashboard (AF-M7-03).
 *
 * No charting library dependency. Each component is a pure presentational
 * component that takes data and renders SVG. Responsive via viewBox.
 */

import { STATUS_COLORS } from "../lib/aggregate";
import type { DailyStatusPoint } from "../lib/types";

/* -------------------------------------------------------------------------- */
/*  Stacked bar chart — executions over time by status                        */
/* -------------------------------------------------------------------------- */

interface StackedBarChartProps {
  data: DailyStatusPoint[];
  height?: number;
}

const STATUSES = [
  "SUCCESS",
  "FAILED",
  "CANCELLED",
  "TIMED_OUT",
  "QUOTA_EXCEEDED",
] as const;

export function StackedBarChart({ data, height = 200 }: StackedBarChartProps) {
  if (data.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-muted-foreground text-sm"
        style={{ height }}
      >
        No data for this period
      </div>
    );
  }

  const maxTotal = Math.max(
    ...data.map((d) => STATUSES.reduce((sum, s) => sum + (d[s] ?? 0), 0)),
    1,
  );

  const barWidth = Math.max(1, Math.floor(800 / data.length) - 2);
  const gap = data.length > 30 ? 0 : 2;
  const svgWidth = data.length * (barWidth + gap);

  return (
    <svg
      viewBox={`0 0 ${svgWidth} ${height}`}
      className="w-full"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Executions over time"
    >
      {data.map((point, i) => {
        const x = i * (barWidth + gap);
        let y = height;
        return (
          <g key={point.date}>
            {STATUSES.map((status) => {
              const value = point[status] ?? 0;
              const barHeight = (value / maxTotal) * (height - 20);
              y -= barHeight;
              return (
                <rect
                  key={status}
                  x={x}
                  y={y}
                  width={barWidth}
                  height={barHeight}
                  fill={STATUS_COLORS[status]}
                  rx={1}
                >
                  <title>{`${point.date}: ${value} ${status}`}</title>
                </rect>
              );
            })}
            {/* Date label — show every Nth to avoid crowding */}
            {data.length <= 14 || i % Math.ceil(data.length / 14) === 0 ? (
              <text
                x={x + barWidth / 2}
                y={height - 2}
                textAnchor="middle"
                className="fill-muted-foreground"
                fontSize={10}
              >
                {point.date.slice(5)}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/*  Horizontal bar chart — error breakdown / top failing workflows            */
/* -------------------------------------------------------------------------- */

interface HorizontalBarChartProps {
  rows: { label: string; value: number }[];
  color?: string;
  height?: number;
}

export function HorizontalBarChart({
  rows,
  color = "#ef4444",
  height,
}: HorizontalBarChartProps) {
  if (rows.length === 0) {
    return (
      <div className="flex items-center justify-center text-muted-foreground text-sm py-4">
        No data
      </div>
    );
  }

  const maxVal = Math.max(...rows.map((r) => r.value), 1);
  const rowHeight = 28;
  const labelWidth = 140;
  const barAreaWidth = 300;
  const totalWidth = labelWidth + barAreaWidth + 50;
  const totalHeight = height ?? rows.length * rowHeight + 10;

  return (
    <svg
      viewBox={`0 0 ${totalWidth} ${totalHeight}`}
      className="w-full"
      preserveAspectRatio="xMinYMin meet"
      role="img"
      aria-label="Breakdown"
    >
      {rows.map((row, i) => {
        const y = i * rowHeight + 4;
        const barW = (row.value / maxVal) * barAreaWidth;
        return (
          <g key={row.label}>
            <text
              x={labelWidth - 8}
              y={y + 16}
              textAnchor="end"
              className="fill-foreground"
              fontSize={12}
            >
              {row.label.length > 18 ? `${row.label.slice(0, 16)}…` : row.label}
            </text>
            <rect
              x={labelWidth}
              y={y + 4}
              width={barW}
              height={16}
              fill={color}
              rx={3}
            />
            <text
              x={labelWidth + barW + 6}
              y={y + 16}
              className="fill-muted-foreground"
              fontSize={11}
            >
              {row.value}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
