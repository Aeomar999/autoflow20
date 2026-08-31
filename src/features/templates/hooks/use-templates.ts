import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import type { inferInput } from "@trpc/tanstack-react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useTRPC } from "@/trpc/client";
import type { trpc } from "@/trpc/server";
import { useTemplatesParams } from "./use-templates-params";

type TemplatesInput = inferInput<typeof trpc.templates.list>;

const toListInput = (params: {
  search: string;
  category: string;
  sort: string;
  page: number;
}): TemplatesInput => ({
  search: params.search,
  category: params.category,
  sort:
    params.sort === "mostInstalled" ||
    params.sort === "recent" ||
    params.sort === "fewestCredentials"
      ? params.sort
      : "mostInstalled",
  page: params.page,
});

/**
 * Hook to fetch the template gallery using suspense
 */
export const useSuspenseTemplates = () => {
  const trpc = useTRPC();
  const [params] = useTemplatesParams();

  return useSuspenseQuery(
    trpc.templates.list.queryOptions(toListInput(params)),
  );
};

/**
 * Non-suspending hook for pagination (returns data or undefined)
 */
export const useTemplates = () => {
  const trpc = useTRPC();
  const [params] = useTemplatesParams();

  return useQuery(trpc.templates.list.queryOptions(toListInput(params)));
};

/**
 * Hook to fetch a single template using suspense
 */
export const useSuspenseTemplate = (slug: string) => {
  const trpc = useTRPC();
  return useSuspenseQuery(trpc.templates.getOne.queryOptions({ slug }));
};

/**
 * Hook to install a template into the user's workspace as a draft.
 * On success the new workflow opens in the editor; the credential
 * checklist is shown on the detail page before install.
 */
export const useInstallTemplate = () => {
  const queryClient = useQueryClient();
  const router = useRouter();
  const trpc = useTRPC();

  return useMutation(
    trpc.templates.instantiate.mutationOptions({
      onSuccess: (data, variables) => {
        toast.success("Installed as a draft");
        queryClient.invalidateQueries(trpc.templates.list.queryOptions({}));
        queryClient.invalidateQueries(
          trpc.templates.getOne.queryFilter({ slug: variables.slug }),
        );
        router.push(`/workflows/${data.workflowId}`);
      },
      onError: (error) => {
        toast.error(`Failed to install template: ${error.message}`);
      },
    }),
  );
};
