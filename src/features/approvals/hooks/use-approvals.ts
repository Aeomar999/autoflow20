"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";

export function useApprovals(params?: {
  status?: "PENDING" | "APPROVED" | "REJECTED" | "TIMED_OUT";
  page?: number;
  pageSize?: number;
}) {
  const trpc = useTRPC();
  return useQuery(trpc.approvals.list.queryOptions(params ?? {}));
}

export function useRespondApproval() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation({
    ...trpc.approvals.respond.mutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: trpc.approvals.list.queryKey(),
      });
    },
  });
}
