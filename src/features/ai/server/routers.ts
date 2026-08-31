import z from "zod";
import prisma from "@/lib/db";
import { nodeManifest } from "@/nodes/manifest";
import {
  createTRPCRouter,
  orgAdminProcedure,
  orgViewerProcedure,
} from "@/trpc/init";

/**
 * AI response-cache reporting and administration (AF-M5-07).
 *
 * Cacheable node types come from the registry (`supportsResponseCache`), never
 * from a hard-coded list here — adding a cacheable node must not require
 * editing this router.
 */
const cacheableNodeTypes = (): string[] =>
  nodeManifest.filter((node) => node.supportsResponseCache).map((n) => n.type);

const periodInput = z.object({
  days: z.number().int().min(1).max(90).default(30),
});

export interface AiCacheStats {
  periodDays: number;
  since: Date;
  /** Node runs served from the cache. */
  hits: number;
  /** Node runs that had a cache configured and still called the provider. */
  misses: number;
  /** hits / (hits + misses); 0 when nothing cacheable ran. */
  hitRate: number;
  /** Cacheable node runs with no TTL configured — excluded from the rate. */
  uncachedRuns: number;
  /** Live (unexpired) entries held for this workspace. */
  entries: number;
  /**
   * Provider spend the live entries have avoided, summed as
   * `costUsd * hitCount` over each entry. Lifetime-of-entry, not period-bound:
   * a hit is not individually timestamped.
   */
  savedUsd: number;
}

export const aiRouter = createTRPCRouter({
  /**
   * Cache hit rate for the org over a rolling window, plus the live entry
   * count and the spend those entries have avoided.
   */
  cacheStats: orgViewerProcedure
    .input(periodInput)
    .query(async ({ ctx, input }): Promise<AiCacheStats> => {
      const since = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);
      const nodeTypes = cacheableNodeTypes();

      const runScope = {
        nodeType: { in: nodeTypes },
        startedAt: { gte: since },
        execution: { workflow: { organizationId: ctx.org.id } },
      };

      const [hits, misses, uncachedRuns, entries, savings] = await Promise.all([
        prisma.nodeExecution.count({
          where: { ...runScope, cacheHit: true },
        }),
        prisma.nodeExecution.count({
          where: { ...runScope, cacheHit: false },
        }),
        prisma.nodeExecution.count({
          where: { ...runScope, cacheHit: null },
        }),
        prisma.aiResponseCache.count({
          where: { organizationId: ctx.org.id, expiresAt: { gt: new Date() } },
        }),
        // The saving is a product of two columns, which Prisma's aggregate
        // cannot express. Summed in the database rather than by fetching every
        // entry — this table grows with usage.
        prisma.$queryRaw<Array<{ saved: number }>>`
          SELECT COALESCE(SUM("costUsd" * "hitCount"), 0)::double precision AS saved
          FROM "AiResponseCache"
          WHERE "organizationId" = ${ctx.org.id}
            AND "expiresAt" > NOW()
        `,
      ]);

      const savedUsd = savings[0]?.saved ?? 0;
      const measured = hits + misses;

      return {
        periodDays: input.days,
        since,
        hits,
        misses,
        hitRate: measured === 0 ? 0 : hits / measured,
        uncachedRuns,
        entries,
        savedUsd: Math.round(savedUsd * 1e6) / 1e6,
      };
    }),

  /**
   * Drops this workspace's cached responses. The escape hatch for a prompt
   * whose cached answer is stale before its TTL expires.
   */
  clearCache: orgAdminProcedure
    .input(z.object({ expiredOnly: z.boolean().default(false) }))
    .mutation(async ({ ctx, input }) => {
      const { count } = await prisma.aiResponseCache.deleteMany({
        where: {
          organizationId: ctx.org.id,
          ...(input.expiredOnly ? { expiresAt: { lte: new Date() } } : {}),
        },
      });
      return { deletedCount: count };
    }),
});
