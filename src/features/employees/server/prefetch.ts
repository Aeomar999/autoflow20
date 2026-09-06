import type { inferInput } from "@trpc/tanstack-react-query";
import { prefetch, trpc } from "@/trpc/server";

type ListInput = inferInput<typeof trpc.employees.list>;

/** Prefetch the paginated, org-scoped employee list. */
export const prefetchEmployees = (params: ListInput) => {
  return prefetch(trpc.employees.list.queryOptions(params));
};

/** Prefetch the count-by-status summary shown in the list header. */
export const prefetchEmployeeStatusCounts = () => {
  return prefetch(trpc.employees.countByStatus.queryOptions());
};

/** Prefetch one employee plus its status-chain timeline. */
export const prefetchEmployee = async (id: string) => {
  await Promise.all([
    prefetch(trpc.employees.getById.queryOptions({ id })),
    prefetch(trpc.employees.timeline.queryOptions({ id })),
  ]);
};
