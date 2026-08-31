import z from "zod";
import prisma from "@/lib/db";
import { createTRPCRouter, orgViewerProcedure } from "@/trpc/init";
import { fillDailySeries, roundUsd } from "../lib/aggregate";
import type { CostSummary } from "../lib/types";

/**
 * Cost views (AF-M5-08): per run, per workflow, per model, over time.
 *
 * Every query is scoped through `Workflow.organizationId` — the same path the
 * executions router uses — rather than `Execution.organizationId`, which is
 * nullable for runs created before the org backfill.
 *
 * Reported spend covers ALL runs in the window, test runs included: a test run
 * bills the provider exactly like a production one, and a cost view that hid
 * that would understate the invoice.
 */

const MAX_ROWS = 10;

const summaryInput = z.object({
  days: z.number().int().min(1).max(90).default(30),
});

/** Raw shape returned by the per-day rollup. */
type DailyQueryRow = {
  day: Date;
  cost: number;
  runs: number;
  tokens_in: number;
  tokens_out: number;
};

export const costsRouter = createTRPCRouter({
  summary: orgViewerProcedure
    .input(summaryInput)
    .query(async ({ ctx, input }): Promise<CostSummary> => {
      const now = new Date();
      const since = new Date(now.getTime() - input.days * 86_400_000);
      const organizationId = ctx.org.id;

      const runScope = {
        workflow: { organizationId },
        startedAt: { gte: since },
      };

      const [totals, dailyRows, workflowGroups, modelGroups, topRuns] =
        await Promise.all([
          prisma.execution.aggregate({
            where: runScope,
            _sum: { costUsd: true, tokensIn: true, tokensOut: true },
            _count: { _all: true },
          }),
          // Prisma cannot express date_trunc; parameterized raw SQL can.
          prisma.$queryRaw<DailyQueryRow[]>`
            SELECT date_trunc('day', e."startedAt") AS day,
                   COALESCE(SUM(e."costUsd"), 0)::double precision AS cost,
                   COUNT(*)::int AS runs,
                   COALESCE(SUM(e."tokensIn"), 0)::double precision AS tokens_in,
                   COALESCE(SUM(e."tokensOut"), 0)::double precision AS tokens_out
            FROM "Execution" e
            JOIN "Workflow" w ON w."id" = e."workflowId"
            WHERE w."organizationId" = ${organizationId}
              AND e."startedAt" >= ${since}
            GROUP BY 1
            ORDER BY 1
          `,
          prisma.execution.groupBy({
            by: ["workflowId"],
            where: runScope,
            _sum: { costUsd: true, tokensIn: true, tokensOut: true },
            _count: { _all: true },
            orderBy: { _sum: { costUsd: "desc" } },
            take: MAX_ROWS,
          }),
          prisma.nodeExecution.groupBy({
            by: ["model"],
            where: {
              model: { not: null },
              startedAt: { gte: since },
              execution: { workflow: { organizationId } },
            },
            _sum: { costUsd: true, tokensIn: true, tokensOut: true },
            _count: { _all: true },
            orderBy: { _sum: { costUsd: "desc" } },
            take: MAX_ROWS,
          }),
          prisma.execution.findMany({
            where: { ...runScope, costUsd: { gt: 0 } },
            orderBy: { costUsd: "desc" },
            take: MAX_ROWS,
            select: {
              id: true,
              status: true,
              startedAt: true,
              costUsd: true,
              tokensIn: true,
              tokensOut: true,
              workflowId: true,
              workflow: { select: { name: true } },
            },
          }),
        ]);

      const workflowNames = new Map(
        (
          await prisma.workflow.findMany({
            where: {
              organizationId,
              id: { in: workflowGroups.map((group) => group.workflowId) },
            },
            select: { id: true, name: true },
          })
        ).map((workflow) => [workflow.id, workflow.name]),
      );

      return {
        periodDays: input.days,
        since,
        totals: {
          costUsd: roundUsd(Number(totals._sum.costUsd ?? 0)),
          tokensIn: totals._sum.tokensIn ?? 0,
          tokensOut: totals._sum.tokensOut ?? 0,
          runs: totals._count._all,
        },
        daily: fillDailySeries(
          dailyRows.map((row) => ({
            day: row.day,
            costUsd: row.cost,
            runs: row.runs,
            tokensIn: row.tokens_in,
            tokensOut: row.tokens_out,
          })),
          input.days,
          now,
        ),
        byWorkflow: workflowGroups.map((group) => ({
          workflowId: group.workflowId,
          // A workflow deleted between the two queries loses its name but not
          // its spend; showing the id beats dropping the row.
          name: workflowNames.get(group.workflowId) ?? group.workflowId,
          costUsd: roundUsd(Number(group._sum.costUsd ?? 0)),
          runs: group._count._all,
          tokensIn: group._sum.tokensIn ?? 0,
          tokensOut: group._sum.tokensOut ?? 0,
        })),
        byModel: modelGroups
          .filter((group): group is typeof group & { model: string } =>
            Boolean(group.model),
          )
          .map((group) => ({
            model: group.model,
            costUsd: roundUsd(Number(group._sum.costUsd ?? 0)),
            nodeRuns: group._count._all,
            tokensIn: group._sum.tokensIn ?? 0,
            tokensOut: group._sum.tokensOut ?? 0,
          })),
        topRuns: topRuns.map((run) => ({
          executionId: run.id,
          workflowId: run.workflowId,
          workflowName: run.workflow.name,
          status: run.status,
          startedAt: run.startedAt,
          costUsd: roundUsd(Number(run.costUsd)),
          tokensIn: run.tokensIn,
          tokensOut: run.tokensOut,
        })),
      };
    }),
});
