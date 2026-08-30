import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { useTRPC } from "@/trpc/client";
import { useKnowledgeParams } from "./use-knowledge-params";

export const useSuspenseKnowledgeSources = () => {
  const trpc = useTRPC();
  const [params] = useKnowledgeParams();

  return useSuspenseQuery(trpc.knowledge.list.queryOptions(params));
};

export const useKnowledgeSources = () => {
  const trpc = useTRPC();
  const [params] = useKnowledgeParams();

  return useQuery(trpc.knowledge.list.queryOptions(params));
};

export const useKnowledgeSource = (id: string | null) => {
  const trpc = useTRPC();
  return useQuery({
    ...trpc.knowledge.getOne.queryOptions({ id: id ?? "" }),
    enabled: Boolean(id),
  });
};

export const useCreateFileSource = () => {
  const queryClient = useQueryClient();
  const trpc = useTRPC();

  return useMutation(
    trpc.knowledge.createFile.mutationOptions({
      onSuccess: (data) => {
        toast.success(`Source "${data.name}" uploaded for ingestion`);
        queryClient.invalidateQueries(trpc.knowledge.list.queryOptions({}));
      },
      onError: (error) => {
        toast.error(`Upload failed: ${error.message}`);
      },
    }),
  );
};

export const useCreateUrlSource = () => {
  const queryClient = useQueryClient();
  const trpc = useTRPC();

  return useMutation(
    trpc.knowledge.createUrl.mutationOptions({
      onSuccess: (data) => {
        toast.success(`Webpage "${data.name}" queued for ingestion`);
        queryClient.invalidateQueries(trpc.knowledge.list.queryOptions({}));
      },
      onError: (error) => {
        toast.error(`Failed to queue URL: ${error.message}`);
      },
    }),
  );
};

export const useCreateTextSource = () => {
  const queryClient = useQueryClient();
  const trpc = useTRPC();

  return useMutation(
    trpc.knowledge.createText.mutationOptions({
      onSuccess: (data) => {
        toast.success(`Text snippet "${data.name}" created`);
        queryClient.invalidateQueries(trpc.knowledge.list.queryOptions({}));
      },
      onError: (error) => {
        toast.error(`Failed to create text source: ${error.message}`);
      },
    }),
  );
};

export const useReindexSource = () => {
  const queryClient = useQueryClient();
  const trpc = useTRPC();

  return useMutation(
    trpc.knowledge.reindex.mutationOptions({
      onSuccess: () => {
        toast.success("Source queued for re-indexing");
        queryClient.invalidateQueries(trpc.knowledge.list.queryOptions({}));
      },
      onError: (error) => {
        toast.error(`Reindex failed: ${error.message}`);
      },
    }),
  );
};

export const useRemoveSource = () => {
  const queryClient = useQueryClient();
  const trpc = useTRPC();

  return useMutation(
    trpc.knowledge.remove.mutationOptions({
      onSuccess: () => {
        toast.success("Knowledge source deleted");
        queryClient.invalidateQueries(trpc.knowledge.list.queryOptions({}));
      },
      onError: (error) => {
        toast.error(`Failed to delete source: ${error.message}`);
      },
    }),
  );
};

export const useTestKnowledgeQuery = () => {
  const trpc = useTRPC();

  return useMutation(
    trpc.knowledge.testQuery.mutationOptions({
      onError: (error) => {
        toast.error(`Search failed: ${error.message}`);
      },
    }),
  );
};
