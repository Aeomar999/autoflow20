"use client";

import { CoinsIcon, DatabaseZapIcon, HashIcon, PlayIcon } from "lucide-react";

import {
  halfOverHalfDelta,
  StatCard,
  StatGrid,
} from "@/components/dashboard/stat-card";

import type { DailyCostPoint } from "../lib/aggregate";
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
  /**
   * The same zero-filled series the trend chart draws. Optional: without it
   * the cards drop their sparklines and period comparison rather than
   * inventing one.
   */
  daily?: DailyCostPoint[];
}

export const CostSummaryCards = ({
  costUsd,
  runs,
  tokensIn,
  tokensOut,
  cache,
  daily,
}: SummaryCardsProps) => {
  const spendSeries = daily?.map((point) => point.costUsd) ?? [];
  const runSeries = daily?.map((point) => point.runs) ?? [];
  const tokenSeries =
    daily?.map((point) => point.tokensIn + point.tokensOut) ?? [];

  return (
    <StatGrid>
      <StatCard
        label="Spend"
        value={formatUsd(costUsd)}
        icon={<CoinsIcon />}
        spark={spendSeries}
        delta={halfOverHalfDelta(spendSeries, { invert: true })}
        detail="Actual provider cost, all runs"
      />
      <StatCard
        label="Runs"
        value={runs.toLocaleString()}
        icon={<PlayIcon />}
        spark={runSeries}
        delta={halfOverHalfDelta(runSeries)}
        detail="Executions started in this window"
      />
      <StatCard
        label="Tokens"
        value={formatTokens(tokensIn + tokensOut)}
        icon={<HashIcon />}
        spark={tokenSeries}
        delta={halfOverHalfDelta(tokenSeries, { invert: true })}
        detail={`${formatTokens(tokensIn)} in / ${formatTokens(tokensOut)} out`}
      />
      <StatCard
        label="Cache hit rate"
        value={cache ? formatPercent(cache.hitRate) : "n/a"}
        icon={<DatabaseZapIcon />}
        detail={
          cache
            ? cache.hits + cache.misses === 0
              ? "No cached AI nodes have run yet"
              : `${cache.hits} of ${cache.hits + cache.misses} cached nodes · ${formatUsd(cache.savedUsd)} avoided`
            : "Cache reporting unavailable"
        }
      />
    </StatGrid>
  );
};
