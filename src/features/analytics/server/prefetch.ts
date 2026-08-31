import { prefetch, trpc } from "@/trpc/server";

/** Server prefetch for the monitoring dashboard (AF-M7-03). */
export const prefetchMonitoringOverview = (days: number) =>
  prefetch(trpc.analytics.overview.queryOptions({ days }));
