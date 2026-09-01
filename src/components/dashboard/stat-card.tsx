import { ArrowDownRightIcon, ArrowUpRightIcon, MinusIcon } from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/utils";

export type StatDelta = {
  /** Signed percentage change, already computed from real series data. */
  pct: number;
  /** What the change is measured against, e.g. "vs previous 15 days". */
  label: string;
  /** Set when a rise is bad (failures, spend) so the colour flips. */
  invert?: boolean;
};

/**
 * Bar sparkline. Real values only: this draws the same series the panel below
 * charts in full, at glanceable size.
 *
 * The bars are neutral and only the peak is drawn in the accent. Colouring the
 * whole sparkline made four cards read as four orange blocks and cost the
 * accent its meaning; one accented bar tells you where the high point sits.
 */
const Sparkbars = ({
  values,
  className,
}: {
  values: number[];
  className?: string;
}) => {
  if (values.length === 0) return null;

  const max = Math.max(...values, 0);
  const bars = values.slice(-24);
  const width = bars.length * 6 - 2;

  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${Math.max(width, 1)} 24`}
      preserveAspectRatio="none"
      className={cn("h-8 w-24 shrink-0", className)}
    >
      <title>Trend</title>
      {bars.map((value, index) => {
        const height = max > 0 ? Math.max(1.5, (value / max) * 24) : 1.5;
        const isPeak = max > 0 && value === max;
        return (
          <rect
            key={`${index}-${value}`}
            x={index * 6}
            y={24 - height}
            width={4}
            height={height}
            rx={1}
            className={isPeak ? "fill-primary" : "fill-muted-foreground/35"}
          />
        );
      })}
    </svg>
  );
};

export const StatGrid = ({
  className,
  ...props
}: React.ComponentProps<"div">) => (
  <div
    className={cn("grid gap-3 sm:grid-cols-2 xl:grid-cols-4", className)}
    {...props}
  />
);

export const StatCard = ({
  label,
  value,
  unit,
  detail,
  delta,
  spark,
  icon,
}: {
  label: string;
  value: string;
  /** Small suffix beside the number, e.g. "runs", "of 5,000". */
  unit?: string;
  /** Footer text when there is no honest period comparison to show. */
  detail?: string;
  delta?: StatDelta | null;
  spark?: number[];
  icon?: React.ReactNode;
}) => {
  const isFlat = !delta || Math.abs(delta.pct) < 0.5;
  const isGood = delta ? (delta.invert ? delta.pct < 0 : delta.pct > 0) : false;
  const DeltaIcon = isFlat
    ? MinusIcon
    : delta && delta.pct > 0
      ? ArrowUpRightIcon
      : ArrowDownRightIcon;

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-hairline bg-panel">
      <div className="flex flex-1 flex-col gap-3 p-4">
        <p className="dash-label text-muted-foreground">{label}</p>
        <div className="flex items-end justify-between gap-3">
          <p className="min-w-0 truncate text-3xl leading-none font-semibold tracking-tight tabular-nums">
            {value}
            {unit ? (
              <span className="ml-1.5 align-baseline text-xs font-normal tracking-normal text-muted-foreground">
                {unit}
              </span>
            ) : null}
          </p>
          {spark && spark.length > 1 ? <Sparkbars values={spark} /> : null}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-hairline bg-well px-4 py-2">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-hairline bg-panel text-muted-foreground [&_svg]:size-3">
          {icon}
        </span>
        <p className="flex min-w-0 items-center justify-end gap-1.5 text-xs text-muted-foreground">
          {delta ? (
            <span
              title={delta.label}
              className={cn(
                "inline-flex shrink-0 items-center gap-0.5 font-medium tabular-nums",
                isFlat
                  ? "text-muted-foreground"
                  : isGood
                    ? "text-success"
                    : "text-danger",
              )}
            >
              <DeltaIcon className="size-3" />
              {isFlat ? "flat" : `${Math.abs(delta.pct).toFixed(1)}%`}
            </span>
          ) : null}
          <span className="truncate">{detail ?? delta?.label}</span>
        </p>
      </div>
    </div>
  );
};

/**
 * Period-over-period change from a daily series, by comparing the second half
 * of the window against the first. Nothing is invented: if the window is too
 * short to split, or the earlier half is empty, there is no comparison and the
 * card falls back to its descriptive footer.
 */
export function halfOverHalfDelta(
  values: number[],
  { invert = false }: { invert?: boolean } = {},
): StatDelta | null {
  if (values.length < 4) return null;

  const mid = Math.floor(values.length / 2);
  const sum = (slice: number[]) => slice.reduce((total, n) => total + n, 0);
  const previous = sum(values.slice(0, mid));
  const current = sum(values.slice(mid));

  if (previous <= 0) return null;

  return {
    pct: ((current - previous) / previous) * 100,
    label: `vs previous ${mid} ${mid === 1 ? "day" : "days"}`,
    invert,
  };
}
