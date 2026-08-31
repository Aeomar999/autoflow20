/**
 * Response types for the analytics router (AF-M7-03).
 *
 * Kept in lib/ so client components can type against them without pulling
 * Prisma. The router imports these, not the other way round.
 */

export interface DailyStatusPoint {
  date: string;
  SUCCESS: number;
  FAILED: number;
  CANCELLED: number;
  TIMED_OUT: number;
  QUOTA_EXCEEDED: number;
  RUNNING: number;
}

export interface OverviewMetrics {
  totalRuns: number;
  successRate: number;
  avgDurationMs: number | null;
  p50DurationMs: number | null;
  p95DurationMs: number | null;
}

export interface ErrorBreakdownRow {
  nodeType: string;
  count: number;
}

export interface TopFailingWorkflowRow {
  workflowId: string;
  workflowName: string;
  failures: number;
  lastFailureAt: Date | null;
}

export interface UsageMetrics {
  currentMonthCount: number;
  planLimit: number | null;
  plan: string;
  remaining: number | null;
}

export interface MonitoringOverview {
  periodDays: number;
  since: Date;
  overview: OverviewMetrics;
  executionsOverTime: DailyStatusPoint[];
  errorBreakdown: ErrorBreakdownRow[];
  topFailingWorkflows: TopFailingWorkflowRow[];
  usage: UsageMetrics;
}
