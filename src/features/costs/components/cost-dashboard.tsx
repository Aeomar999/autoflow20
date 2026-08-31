"use client";

import {
  EntityContainer,
  ErrorView,
  LoadingView,
} from "@/components/entity-components";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
 * Cost views (AF-M5-08): per run, per workflow, per model, over time — plus
 * the AF-M5-07 cache hit rate, which is the lever for lowering the number
 * above it.
 */
export const CostDashboard = () => {
  const { data: summary } = useSuspenseCostSummary();
  const { data: cache } = useSuspenseCacheStats();

  return (
    <div className="space-y-4">
      <CostSummaryCards
        costUsd={summary.totals.costUsd}
        runs={summary.totals.runs}
        tokensIn={summary.totals.tokensIn}
        tokensOut={summary.totals.tokensOut}
        cache={cache}
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
    <div className="flex flex-row items-center justify-between gap-x-4">
      <div className="flex flex-col">
        <h1 className="text-lg md:text-xl font-semibold">Costs</h1>
        <p className="text-xs md:text-sm text-muted-foreground">
          Actual AI spend recorded on completed runs, test runs included
        </p>
      </div>
      <Select
        value={String(params.days)}
        onValueChange={(value) => setParams({ days: Number(value) })}
      >
        <SelectTrigger className="w-[140px] h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {COST_PERIOD_DAYS.map((days) => (
            <SelectItem key={days} value={String(days)}>
              Last {days} days
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};

export const CostsContainer = ({ children }: { children: React.ReactNode }) => (
  <EntityContainer header={<CostsHeader />}>{children}</EntityContainer>
);

export const CostsLoading = () => <LoadingView message="Loading costs..." />;

export const CostsError = () => <ErrorView message="Error loading cost data" />;
