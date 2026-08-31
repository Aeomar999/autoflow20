"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
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
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import type { DailyCostPoint } from "../lib/aggregate";
import { formatDayLabel, formatUsd } from "../lib/format";

const chartConfig = {
  costUsd: { label: "Spend", color: "var(--chart-1)" },
} satisfies ChartConfig;

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

  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle className="text-base">Spend over time</CardTitle>
        <CardDescription>
          Daily provider cost across the last {periodDays} days (UTC days).
        </CardDescription>
      </CardHeader>
      <CardContent>
        {hasSpend ? (
          <ChartContainer config={chartConfig} className="h-[220px] w-full">
            <AreaChart data={daily} margin={{ left: 4, right: 4, top: 4 }}>
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
                width={64}
                tickFormatter={(value: number) => formatUsd(value)}
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
                fill="var(--color-costUsd)"
                fillOpacity={0.2}
                strokeWidth={2}
              />
            </AreaChart>
          </ChartContainer>
        ) : (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No AI spend recorded in this window.
          </p>
        )}
      </CardContent>
    </Card>
  );
};
