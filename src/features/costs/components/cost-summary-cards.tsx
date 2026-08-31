"use client";

import { CoinsIcon, DatabaseZapIcon, HashIcon, PlayIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatPercent, formatTokens, formatUsd } from "../lib/format";

interface SummaryCardsProps {
  costUsd: number;
  runs: number;
  tokensIn: number;
  tokensOut: number;
  cache: {
    hits: number;
    misses: number;
    hitRate: number;
    savedUsd: number;
  } | null;
}

const Metric = ({
  icon,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
}) => (
  <Card className="shadow-none">
    <CardContent className="p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{detail}</p>
    </CardContent>
  </Card>
);

export const CostSummaryCards = ({
  costUsd,
  runs,
  tokensIn,
  tokensOut,
  cache,
}: SummaryCardsProps) => (
  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
    <Metric
      icon={<CoinsIcon className="size-3.5" />}
      label="Spend"
      value={formatUsd(costUsd)}
      detail="Actual provider cost, all runs"
    />
    <Metric
      icon={<PlayIcon className="size-3.5" />}
      label="Runs"
      value={runs.toLocaleString()}
      detail="Executions started in this window"
    />
    <Metric
      icon={<HashIcon className="size-3.5" />}
      label="Tokens"
      value={formatTokens(tokensIn + tokensOut)}
      detail={`${formatTokens(tokensIn)} in / ${formatTokens(tokensOut)} out`}
    />
    <Metric
      icon={<DatabaseZapIcon className="size-3.5" />}
      label="Cache hit rate"
      value={cache ? formatPercent(cache.hitRate) : "—"}
      detail={
        cache
          ? cache.hits + cache.misses === 0
            ? "No cached AI nodes have run yet"
            : `${cache.hits} of ${cache.hits + cache.misses} cached nodes · ${formatUsd(cache.savedUsd)} avoided`
          : "Cache reporting unavailable"
      }
    />
  </div>
);
