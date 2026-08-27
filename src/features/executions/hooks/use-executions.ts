import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { useExecutionsParams } from "./use-executions-params";

type ExecutionStatusFilter =
  | "RUNNING"
  | "SUCCESS"
  | "FAILED"
  | "CANCELLED"
  | "TIMED_OUT"
  | "";

/**
 * Hook to fetch all executions using suspense.
 * Auto-refreshes every 3s while any execution is RUNNING.
 */
export const useSuspenseExecutions = () => {
  const trpc = useTRPC();
  const [params] = useExecutionsParams();

  return useSuspenseQuery({
    ...trpc.executions.list.queryOptions({
      ...params,
      status: (params.status as ExecutionStatusFilter) || undefined,
    }),
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data?.items?.some((e) => e.status === "RUNNING")) {
        return 3_000;
      }
      return false;
    },
  });
};

/**
 * Non-suspending hook for pagination (returns data or undefined).
 * Auto-refreshes every 3s while any execution is RUNNING.
 */
export const useExecutions = () => {
  const trpc = useTRPC();
  const [params] = useExecutionsParams();

  return useQuery({
    ...trpc.executions.list.queryOptions({
      ...params,
      status: (params.status as ExecutionStatusFilter) || undefined,
    }),
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data?.items?.some((e) => e.status === "RUNNING")) {
        return 3_000;
      }
      return false;
    },
  });
};

/**
 * Hook to fetch a single execution using suspense.
 * Auto-refreshes every 3s while the execution is RUNNING.
 */
export const useSuspenseExecution = (id: string) => {
  const trpc = useTRPC();
  return useSuspenseQuery({
    ...trpc.executions.getOne.queryOptions({ id }),
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data?.status === "RUNNING") {
        return 3_000;
      }
      return false;
    },
  });
};
