import z from "zod";
import prisma from "@/lib/db";
import { COUNTABLE_EXECUTION_STATUSES, resolvePlanLimits } from "@/lib/quotas";
import { createTRPCRouter, orgViewerProcedure } from "@/trpc/init";
import { buildStatusSeries } from "../lib/aggregate";
import type {
  ErrorBreakdownRow,
  MonitoringOverview,
  OverviewMetrics,
  UsageMetrics,
} from "../lib/types";

/**
 * Monitoring dashboard router (AF-M7-03).
 *
 * Every query is scoped through `ctx.org.id`. The cost surfaces (costByModel,
 * spend series) are delegated to the existing `costs.summary` router per the
 * M7 spec — analytics composes, not re-implements.
 */

const overviewInput = z.object({
  days: z.number().int().min(1).max(90).default(30),
});

export const analyticsRouter = createTRPCRouter({
  overview: orgViewerProcedure
    .input(overviewInput)
    .query(async ({ ctx, input }): Promise<MonitoringOverview> => {
      const now = new Date();
      const since = new Date(now.getTime() - input.days * 86_400_000);
      const organizationId = ctx.org.id;

      const runScope = {
        workflow: { organizationId },
        startedAt: { gte: since },
      };

      const [
        overview,
        statusRows,
        errorRows,
        topFailingRows,
        currentMonthCount,
        org,
      ] = await Promise.all([
        // Aggregate overview metrics
        prisma.execution.aggregate({
          where: runScope,
          _count: { _all: true },
          _avg: { durationMs: true },
        }),

        // Executions over time by status (raw SQL for date_trunc)
        prisma.$queryRaw<{ day: Date; status: string; count: number }[]>`
          SELECT date_trunc('day', e."startedAt") AS day,
                 e."status",
                 COUNT(*)::int AS count
          FROM "Execution" e
          JOIN "Workflow" w ON w."id" = e."workflowId"
          WHERE w."organizationId" = ${organizationId}
            AND e."startedAt" >= ${since}
          GROUP BY 1, 2
          ORDER BY 1
        `,

        // Error breakdown by nodeType (failed node executions only)
        prisma.$queryRaw<ErrorBreakdownRow[]>`
          SELECT ne."nodeType",
                 COUNT(*)::int AS count
          FROM "NodeExecution" ne
          JOIN "Execution" e ON e."id" = ne."executionId"
          JOIN "Workflow" w ON w."id" = e."workflowId"
          WHERE w."organizationId" = ${organizationId}
            AND ne."status" = 'FAILED'
            AND e."startedAt" >= ${since}
          GROUP BY ne."nodeType"
          ORDER BY count DESC
          LIMIT 10
        `,

        // Top failing workflows
        prisma.$queryRaw<
          {
            workflowId: string;
            workflowName: string;
            failures: number;
            lastFailureAt: Date | null;
          }[]
        >`
          SELECT e."workflowId",
                 w."name" AS "workflowName",
                 COUNT(*)::int AS failures,
                 MAX(e."startedAt") AS "lastFailureAt"
          FROM "Execution" e
          JOIN "Workflow" w ON w."id" = e."workflowId"
          WHERE w."organizationId" = ${organizationId}
            AND e."status" IN ('FAILED', 'TIMED_OUT')
            AND e."startedAt" >= ${since}
          GROUP BY e."workflowId", w."name"
          ORDER BY failures DESC
          LIMIT 10
        `,

        // Current-month execution count for quota usage
        prisma.execution.count({
          where: {
            workflow: { organizationId },
            status: { in: [...COUNTABLE_EXECUTION_STATUSES] },
            startedAt: {
              gte: new Date(now.getUTCFullYear(), now.getUTCMonth(), 1),
            },
          },
        }),

        // Org plan for quota display
        prisma.organization.findUnique({
          where: { id: organizationId },
          select: { plan: true },
        }),
      ]);

      // p50/p95 duration via PERCENTILE_CONT (raw SQL, org-scoped)
      const percentiles = await prisma.$queryRaw<
        { p50: number | null; p95: number | null }[]
      >`
          SELECT
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ne."durationMs") AS p50,
            PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY ne."durationMs") AS p95
          FROM "NodeExecution" ne
          JOIN "Execution" e ON e."id" = ne."executionId"
          JOIN "Workflow" w ON w."id" = e."workflowId"
          WHERE w."organizationId" = ${organizationId}
            AND ne."durationMs" IS NOT NULL
            AND e."startedAt" >= ${since}
        `;

      const p = percentiles[0];
      const overviewMetrics: OverviewMetrics = {
        totalRuns: overview._count._all,
        successRate:
          overview._count._all > 0
            ? // Success rate calculated from status series (more accurate)
              (() => {
                const successCount = statusRows
                  .filter((r) => r.status === "SUCCESS")
                  .reduce((sum, r) => sum + r.count, 0);
                return Math.round((successCount / overview._count._all) * 100);
              })()
            : 0,
        avgDurationMs: overview._avg.durationMs
          ? Math.round(overview._avg.durationMs)
          : null,
        p50DurationMs: p?.p50 != null ? Math.round(Number(p.p50)) : null,
        p95DurationMs: p?.p95 != null ? Math.round(Number(p.p95)) : null,
      };

      const executionsOverTime = buildStatusSeries(statusRows, input.days, now);

      const plan = org?.plan ?? "FREE";
      const limits = resolvePlanLimits(plan);
      const usageMetrics: UsageMetrics = {
        currentMonthCount,
        planLimit:
          limits.monthlyExecutions === Infinity
            ? null
            : limits.monthlyExecutions,
        plan,
        remaining:
          limits.monthlyExecutions === Infinity
            ? null
            : Math.max(0, limits.monthlyExecutions - currentMonthCount),
      };

      return {
        periodDays: input.days,
        since,
        overview: overviewMetrics,
        executionsOverTime,
        errorBreakdown: errorRows,
        topFailingWorkflows: topFailingRows,
        usage: usageMetrics,
      };
    }),
});
