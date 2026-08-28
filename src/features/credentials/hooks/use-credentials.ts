import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { PAGINATION } from "@/config/constants";
import { useTRPC } from "@/trpc/client";
import { useCredentialsParams } from "./use-credentials-params";

/**
 * Hook to fetch all credentials using suspense
 */
export const useSuspenseCredentials = () => {
  const trpc = useTRPC();
  const [params] = useCredentialsParams();

  return useSuspenseQuery(trpc.credentials.list.queryOptions(params));
};

/**
 * Non-suspending hook for pagination (returns data or undefined)
 */
export const useCredentials = () => {
  const trpc = useTRPC();
  const [params] = useCredentialsParams();

  return useQuery(trpc.credentials.list.queryOptions(params));
};

/**
 * Hook to create a new credentials
 */
export const useCreateCredential = () => {
  const queryClient = useQueryClient();
  const trpc = useTRPC();

  return useMutation(
    trpc.credentials.create.mutationOptions({
      onSuccess: (data) => {
        toast.success(`Credential "${data.name}" created`);
        queryClient.invalidateQueries(trpc.credentials.list.queryOptions({}));
      },
      onError: (error) => {
        toast.error(`Failed to create credential: ${error.message}`);
      },
    }),
  );
};

/**
 * Hook to remove a credential
 */
export const useRemoveCredential = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation(
    trpc.credentials.remove.mutationOptions({
      onSuccess: (data) => {
        toast.success(`Credential removed`);
        queryClient.invalidateQueries(trpc.credentials.list.queryOptions({}));
        queryClient.invalidateQueries(
          trpc.credentials.getOne.queryFilter({ id: data.id }),
        );
      },
    }),
  );
};

/**
 * Hook to fetch a single credential using suspense
 */
export const useSuspenseCredential = (id: string) => {
  const trpc = useTRPC();
  return useSuspenseQuery(trpc.credentials.getOne.queryOptions({ id }));
};

/**
 * Hook to update a credential
 */
export const useUpdateCredential = () => {
  const queryClient = useQueryClient();
  const trpc = useTRPC();

  return useMutation(
    trpc.credentials.update.mutationOptions({
      onSuccess: (data) => {
        toast.success(`Credential "${data.name}" saved`);
        queryClient.invalidateQueries(trpc.credentials.list.queryOptions({}));
        queryClient.invalidateQueries(
          trpc.credentials.getOne.queryOptions({ id: data.id }),
        );
      },
      onError: (error) => {
        toast.error(`Failed to save credential: ${error.message}`);
      },
    }),
  );
};

/**
 * Hook to fetch credentials of one registry type (used by node dialogs).
 * Type ids are registry ids, e.g. "openai.apiKey" — never enum names.
 */
export const useCredentialsByType = (type: string) => {
  const trpc = useTRPC();
  return useQuery(
    trpc.credentials.list.queryOptions({
      type,
      pageSize: PAGINATION.MAX_PAGE_SIZE,
    }),
  );
};

/**
 * Hook to test a credential's connection via its provider tester.
 * Returns { ok } or { ok: false, error }.
 */
export const useTestCredential = () => {
  const trpc = useTRPC();

  return useMutation(
    trpc.credentials.test.mutationOptions({
      onSuccess: (data) => {
        if (data.ok) {
          toast.success("Connection successful");
        } else {
          const messages: Record<string, string> = {
            AUTH: "Authentication failed — check your credentials",
            CONNECTION: "Connection error — could not reach the provider",
            TIMEOUT: "Connection timed out",
            NOT_TESTABLE: "This credential type does not support testing",
          };
          toast.error(messages[data.error] ?? "Test failed");
        }
      },
      onError: (error) => {
        toast.error(`Test failed: ${error.message}`);
      },
    }),
  );
};

/**
 * Hook to fetch workflows that reference a credential (for delete warnings).
 */
export const useCredentialUsage = (credentialId: string, enabled: boolean) => {
  const trpc = useTRPC();
  return useQuery({
    ...trpc.credentials.getUsage.queryOptions({ id: credentialId }),
    enabled,
  });
};
