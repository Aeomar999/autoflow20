"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";

export function useOrganizations() {
  const trpc = useTRPC();
  return useQuery(trpc.organizations.list.queryOptions());
}

export function useCreateOrganization() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation({
    ...trpc.organizations.create.mutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: trpc.organizations.list.queryKey(),
      });
    },
  });
}

export function useUpdateOrganization() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation({
    ...trpc.organizations.update.mutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: trpc.organizations.list.queryKey(),
      });
    },
  });
}

export function useDeleteOrganization() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation({
    ...trpc.organizations.delete.mutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: trpc.organizations.list.queryKey(),
      });
    },
  });
}

export function useMembers() {
  const trpc = useTRPC();
  return useQuery(trpc.organizations.getMembers.queryOptions());
}

export function useInviteMember() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation({
    ...trpc.organizations.inviteMember.mutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: trpc.organizations.listInvitations.queryKey(),
      });
    },
  });
}

export function useUpdateMemberRole() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation({
    ...trpc.organizations.updateMemberRole.mutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: trpc.organizations.getMembers.queryKey(),
      });
    },
  });
}

export function useRemoveMember() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation({
    ...trpc.organizations.removeMember.mutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: trpc.organizations.getMembers.queryKey(),
      });
    },
  });
}

export function useInvitations() {
  const trpc = useTRPC();
  return useQuery(trpc.organizations.listInvitations.queryOptions());
}

export function useCancelInvitation() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation({
    ...trpc.organizations.cancelInvitation.mutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: trpc.organizations.listInvitations.queryKey(),
      });
    },
  });
}

export function useAcceptInvite() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation({
    ...trpc.organizations.acceptInvite.mutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: trpc.organizations.list.queryKey(),
      });
    },
  });
}

export function useAuditLogs(params?: {
  page?: number;
  pageSize?: number;
  action?: string;
  resourceType?: string;
}) {
  const trpc = useTRPC();
  return useQuery(trpc.organizations.listAuditLogs.queryOptions(params ?? {}));
}
