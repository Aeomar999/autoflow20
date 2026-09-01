"use client";

import { CoinsIcon } from "lucide-react";

import {
  DashboardError,
  DashboardLoading,
  DashboardPage,
  PageHeader,
  RangeSelect,
} from "@/components/dashboard/page";

import {
  useSuspenseCacheStats,
  useSuspenseCostSummary,
} from "../hooks/use-costs";
import { useCostsParams } from "../hooks/use-costs-params";
import { COST_PERIOD_DAYS } from "../params";
import {
  ModelCostTable,
  RunCostTable,
  WorkflowCostTable,
} from "./cost-breakdown-tables";
import { CostSummaryCards } from "./cost-summary-cards";
import { CostTrendChart } from "./cost-trend-chart";

/**
 * Cost views (AF-M5-08): per run, per workflow, per model, over time, plus
 * the AF-M5-07 cache hit rate, which is the lever for lowering the number
 * above it.
 */
export const CostDashboard = () => {
  const { data: summary } = useSuspenseCostSummary();
  const { data: cache } = useSuspenseCacheStats();

  return (
    <div className="flex flex-col gap-4">
      <CostSummaryCards
        costUsd={summary.totals.costUsd}
        runs={summary.totals.runs}
        tokensIn={summary.totals.tokensIn}
        tokensOut={summary.totals.tokensOut}
        cache={cache}
        daily={summary.daily}
      />
      <CostTrendChart daily={summary.daily} periodDays={summary.periodDays} />
      <div className="grid gap-4 lg:grid-cols-2">
        <WorkflowCostTable
          rows={summary.byWorkflow}
          totalUsd={summary.totals.costUsd}
        />
        <ModelCostTable
          rows={summary.byModel}
          totalUsd={summary.totals.costUsd}
        />
      </div>
      <RunCostTable rows={summary.topRuns} />
    </div>
  );
};

export const CostsHeader = () => {
  const [params, setParams] = useCostsParams();

  return (
    <PageHeader
      title="Costs"
      description="Actual AI spend recorded on completed runs, test runs included"
      actions={
        <>
          <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
            <CoinsIcon className="size-3.5" />
            Provider-reported spend
          </span>
          <RangeSelect
            value={params.days}
            options={COST_PERIOD_DAYS}
            onChange={(days) => setParams({ days })}
          />
        </>
      }
    />
  );
};

export const CostsContainer = ({ children }: { children: React.ReactNode }) => (
  <DashboardPage>
    <CostsHeader />
    {children}
  </DashboardPage>
);

export const CostsLoading = () => (
  <DashboardLoading message="Loading costs..." />
);

export const CostsError = () => (
  <DashboardError message="Error loading cost data" />
);
