import { useSuspenseQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { normalizeCostPeriodDays } from "../params";
import { useCostsParams } from "./use-costs-params";

/** The window both queries share, clamped to what the routers accept. */
const usePeriodDays = (): number => {
  const [params] = useCostsParams();
  return normalizeCostPeriodDays(params.days);
};

export const useSuspenseCostSummary = () => {
  const trpc = useTRPC();
  const days = usePeriodDays();

  return useSuspenseQuery(trpc.costs.summary.queryOptions({ days }));
};

export const useSuspenseCacheStats = () => {
  const trpc = useTRPC();
  const days = usePeriodDays();

  return useSuspenseQuery(trpc.ai.cacheStats.queryOptions({ days }));
};
