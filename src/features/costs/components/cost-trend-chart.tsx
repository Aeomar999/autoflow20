"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

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

import type { DailyCostPoint } from "../lib/aggregate";
import { formatDayLabel, formatUsd } from "../lib/format";

/**
 * Spend is the page's headline number, so the series is drawn in the brand
 * accent rather than a neutral chart colour. It is the only accent on the
 * page apart from primary actions.
 */
const chartConfig = {
  costUsd: { label: "Spend", color: "var(--primary)" },
} satisfies ChartConfig;

/**
 * Axis ticks, not amounts. `formatUsd` keeps four decimals below a dollar so a
 * $0.0004 run stays visible in a table; on a Y axis that prints "$0.6000".
 */
const axisUsd = (value: number) =>
  value >= 10 ? `$${Math.round(value)}` : `$${value.toFixed(2)}`;

/**
 * Spend over time. Days with no runs are plotted as real zeros (the series is
 * zero-filled server-side) so a quiet week reads as quiet, not as a straight
 * line between two busy days.
 */
export const CostTrendChart = ({
  daily,
  periodDays,
}: {
  daily: DailyCostPoint[];
  periodDays: number;
}) => {
  const hasSpend = daily.some((point) => point.costUsd > 0);
  const total = daily.reduce((sum, point) => sum + point.costUsd, 0);
  const peak = daily.reduce(
    (highest: DailyCostPoint | null, point) =>
      highest && highest.costUsd >= point.costUsd ? highest : point,
    null,
  );

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle hint="Provider cost recorded on completed runs, bucketed by the UTC day the run started.">
          Spend over time
        </PanelTitle>
        <p className="text-sm font-semibold tabular-nums">{formatUsd(total)}</p>
      </PanelHeader>

      {hasSpend ? (
        <PanelBody>
          <ChartContainer config={chartConfig} className="h-[228px] w-full">
            <AreaChart data={daily} margin={{ left: 4, right: 4, top: 4 }}>
              <defs>
                <linearGradient id="cost-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0%"
                    stopColor="var(--color-costUsd)"
                    stopOpacity={0.32}
                  />
                  <stop
                    offset="100%"
                    stopColor="var(--color-costUsd)"
                    stopOpacity={0.02}
                  />
                </linearGradient>
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
                tickLine={false}
                axisLine={false}
                width={64}
                tickFormatter={axisUsd}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(label) => formatDayLabel(String(label))}
                    formatter={(value) => formatUsd(Number(value))}
                  />
                }
              />
              <Area
                dataKey="costUsd"
                type="monotone"
                stroke="var(--color-costUsd)"
                fill="url(#cost-fill)"
                strokeWidth={2}
              />
            </AreaChart>
          </ChartContainer>
        </PanelBody>
      ) : (
        <PanelEmpty>No AI spend recorded in this window.</PanelEmpty>
      )}

      <PanelFooter>
        <span className="tabular-nums">Last {periodDays} days, UTC</span>
        {peak && peak.costUsd > 0 ? (
          <span className="tabular-nums">
            Peak {formatDayLabel(peak.date)} at {formatUsd(peak.costUsd)}
          </span>
        ) : null}
      </PanelFooter>
    </Panel>
  );
};
