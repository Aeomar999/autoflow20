import type { DailyCostPoint } from "./aggregate";

/**
 * Shapes returned by `costs.summary` (AF-M5-08).
 *
 * They live in `lib/` rather than beside the router so client components can
 * type against them without importing a module that pulls in Prisma. The
 * router imports these, not the other way round.
 */

export interface WorkflowCostRow {
  workflowId: string;
  name: string;
  costUsd: number;
  runs: number;
  tokensIn: number;
  tokensOut: number;
}

export interface ModelCostRow {
  model: string;
  costUsd: number;
  nodeRuns: number;
  tokensIn: number;
  tokensOut: number;
}

export interface RunCostRow {
  executionId: string;
  workflowId: string;
  workflowName: string;
  status: string;
  startedAt: Date;
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
}

export interface CostSummary {
  periodDays: number;
  since: Date;
  totals: {
    costUsd: number;
    tokensIn: number;
    tokensOut: number;
    runs: number;
  };
  daily: DailyCostPoint[];
  byWorkflow: WorkflowCostRow[];
  byModel: ModelCostRow[];
  topRuns: RunCostRow[];
}
