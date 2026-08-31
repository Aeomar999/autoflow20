import { prefetch, trpc } from "@/trpc/server";

/** Server prefetch for the cost dashboard (AF-M5-08). */
export const prefetchCostSummary = (days: number) =>
  prefetch(trpc.costs.summary.queryOptions({ days }));

/** Cache hit-rate card on the same page (AF-M5-07). */
export const prefetchCacheStats = (days: number) =>
  prefetch(trpc.ai.cacheStats.queryOptions({ days }));
