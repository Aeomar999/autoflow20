import * as React from "react"
import { Bar, BarChart, Cell } from "recharts"
import { HelpCircle } from "lucide-react"

import { Card, CardContent } from "@/components/ui/card"
import { ChartContainer } from "@/components/ui/chart"
import { cn } from "@/lib/utils"

export type KpiDataPoint = {
  value: number
  color?: string
}

export interface KpiCardProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string
  value: string
  trend: string
  trendLabel: string
  trendDirection?: "up" | "down"
  data: (number | KpiDataPoint)[]
  defaultChartColor?: string
}

export function KpiCard({
  title,
  value,
  trend,
  trendLabel,
  trendDirection = "up",
  data,
  defaultChartColor = "#f97316", // Default orange
  className,
  ...props
}: KpiCardProps) {
  // Format data for recharts
  const chartData = data.map((item, index) => {
    if (typeof item === "number") {
      return { value: item, index, fill: defaultChartColor }
    }
    return { value: item.value, index, fill: item.color || defaultChartColor }
  })

  return (
    <Card 
      className={cn("bg-[#1a1c23] border-white/5 text-white shadow-none rounded-xl", className)} 
      {...props}
    >
      <CardContent className="p-5 flex flex-col h-full justify-between gap-4">
        {/* Top Section */}
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold text-white/40 tracking-widest uppercase">
            {title}
          </span>
        </div>

        {/* Middle Section: Value and Chart */}
        <div className="flex items-end justify-between mt-2">
          <div className="text-3xl leading-none font-semibold tracking-tight">
            {value}
          </div>
          
          <div className="w-[80px] h-[36px]">
            <ChartContainer config={{ value: { color: defaultChartColor } }}>
              <BarChart data={chartData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                <Bar dataKey="value" radius={[1, 1, 1, 1]} barSize={3}>
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ChartContainer>
          </div>
        </div>

        {/* Bottom Section: Icon and Trend */}
        <div className="flex items-center justify-between mt-2">
          <HelpCircle className="w-[14px] h-[14px] text-white/30 cursor-pointer hover:text-white/70 transition-colors" />
          <div className="text-[12px] font-medium">
            <span className={cn(
              trendDirection === "up" ? "text-emerald-500" : "text-rose-500"
            )}>
              {trendDirection === "up" ? "+" : "-"}{trend}
            </span>
            <span className="text-white/40 ml-1.5">{trendLabel}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
