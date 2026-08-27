import type { inferInput } from "@trpc/tanstack-react-query";
import { prefetch, trpc } from "@/trpc/server";

type ListInput = inferInput<typeof trpc.executions.list>;

/**
 * Prefetch all executions with optional filters.
 */
export const prefetchExecutions = (params: ListInput) => {
  return prefetch(trpc.executions.list.queryOptions(params));
};

/**
 * Prefetch a single execution
 */
export const prefetchExecution = (id: string) => {
  return prefetch(trpc.executions.getOne.queryOptions({ id }));
};
