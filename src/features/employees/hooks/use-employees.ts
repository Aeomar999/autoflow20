import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { toast } from "sonner";

import type { EmployeeStatus } from "@/features/employees/lib/employee";
import { useTRPC } from "@/trpc/client";

import { useEmployeesParams } from "./use-employees-params";

const toListInput = (params: { status: string; [key: string]: unknown }) => {
  const { status, ...rest } = params;
  return { ...rest, status: (status as EmployeeStatus) || undefined };
};

/** Paginated, org-scoped employee list (suspending). */
export const useSuspenseEmployees = () => {
  const trpc = useTRPC();
  const [params] = useEmployeesParams();

  return useSuspenseQuery(
    trpc.employees.list.queryOptions(toListInput(params)),
  );
};

/** Same query, non-suspending — used by the pagination footer. */
export const useEmployees = () => {
  const trpc = useTRPC();
  const [params] = useEmployeesParams();

  return useQuery(trpc.employees.list.queryOptions(toListInput(params)));
};

/** Count-by-status summary for the list header (AF-M11-09). */
export const useEmployeeStatusCounts = () => {
  const trpc = useTRPC();
  return useQuery(trpc.employees.countByStatus.queryOptions());
};

export const useSuspenseEmployee = (id: string) => {
  const trpc = useTRPC();
  return useSuspenseQuery(trpc.employees.getById.queryOptions({ id }));
};

export const useSuspenseEmployeeTimeline = (id: string) => {
  const trpc = useTRPC();
  return useSuspenseQuery(trpc.employees.timeline.queryOptions({ id }));
};

export const useCreateEmployee = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation(
    trpc.employees.create.mutationOptions({
      onSuccess: (data) => {
        toast.success(`${data.fullName} added as a candidate`);
        queryClient.invalidateQueries(trpc.employees.list.queryFilter());
      },
      onError: (error) => {
        toast.error(`Could not add employee: ${error.message}`);
      },
    }),
  );
};

export const useUpdateEmployee = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation(
    trpc.employees.patch.mutationOptions({
      onSuccess: (data) => {
        toast.success(`${data.fullName} saved`);
        queryClient.invalidateQueries(trpc.employees.list.queryFilter());
        queryClient.invalidateQueries(
          trpc.employees.getById.queryFilter({ id: data.id }),
        );
      },
      onError: (error) => {
        toast.error(`Could not save employee: ${error.message}`);
      },
    }),
  );
};
