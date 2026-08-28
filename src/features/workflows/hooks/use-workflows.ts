import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { useSetAtom } from "jotai";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { saveStatusAtom } from "@/features/editor/store/atoms";
import { useTRPC } from "@/trpc/client";
import { useWorkflowsParams } from "./use-workflows-params";

/**
 * Hook to fetch all workflows using suspense
 */
export const useSuspenseWorkflows = () => {
  const trpc = useTRPC();
  const [params] = useWorkflowsParams();

  return useSuspenseQuery(trpc.workflows.getMany.queryOptions(params));
};

/**
 * Non-suspending hook for pagination (returns data or undefined)
 */
export const useWorkflows = () => {
  const trpc = useTRPC();
  const [params] = useWorkflowsParams();

  return useQuery(trpc.workflows.getMany.queryOptions(params));
};

/**
 * Hook to create a new workflow
 */
export const useCreateWorkflow = () => {
  const queryClient = useQueryClient();
  const trpc = useTRPC();

  return useMutation(
    trpc.workflows.create.mutationOptions({
      onSuccess: (data) => {
        toast.success(`Workflow "${data.name}" created`);
        queryClient.invalidateQueries(trpc.workflows.getMany.queryOptions({}));
      },
      onError: (error) => {
        toast.error(`Failed to create workflow: ${error.message}`);
      },
    }),
  );
};

/**
 * Hook to remove a workflow
 */
export const useRemoveWorkflow = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation(
    trpc.workflows.remove.mutationOptions({
      onSuccess: (data) => {
        toast.success(`Workflow "${data.name}" removed`);
        queryClient.invalidateQueries(trpc.workflows.getMany.queryOptions({}));
        queryClient.invalidateQueries(
          trpc.workflows.getOne.queryFilter({ id: data.id }),
        );
      },
    }),
  );
};

/**
 * Hook to fetch a single workflow using suspense
 */
export const useSuspenseWorkflow = (id: string) => {
  const trpc = useTRPC();
  return useSuspenseQuery(trpc.workflows.getOne.queryOptions({ id }));
};

/**
 * Hook to update a workflow name
 */
export const useUpdateWorkflowName = () => {
  const queryClient = useQueryClient();
  const trpc = useTRPC();

  return useMutation(
    trpc.workflows.updateName.mutationOptions({
      onSuccess: (data) => {
        toast.success(`Workflow "${data.name}" updated`);
        queryClient.invalidateQueries(trpc.workflows.getMany.queryOptions({}));
        queryClient.invalidateQueries(
          trpc.workflows.getOne.queryOptions({ id: data.id }),
        );
      },
      onError: (error) => {
        toast.error(`Failed to update workflow: ${error.message}`);
      },
    }),
  );
};

/**
 * Hook to save a workflow graph (with optimistic concurrency)
 */
export const useSaveWorkflow = () => {
  const queryClient = useQueryClient();
  const trpc = useTRPC();
  const setSaveStatus = useSetAtom(saveStatusAtom);

  return useMutation(
    trpc.workflows.saveGraph.mutationOptions({
      onSuccess: (_data, variables) => {
        setSaveStatus("saved");
        queryClient.invalidateQueries(trpc.workflows.getMany.queryOptions({}));
        queryClient.invalidateQueries(
          trpc.workflows.getOne.queryOptions({ id: variables.id }),
        );
      },
      onError: (error, variables) => {
        setSaveStatus("failed");
        if (error.data?.code === "CONFLICT") {
          toast.error(
            "Workflow was modified elsewhere. Reloading latest version.",
          );
          queryClient.invalidateQueries(
            trpc.workflows.getOne.queryOptions({ id: variables.id }),
          );
        } else {
          toast.error(`Failed to save workflow: ${error.message}`);
        }
      },
    }),
  );
};

/**
 * Hook to execute a workflow
 */
export const useExecuteWorkflow = () => {
  const trpc = useTRPC();

  return useMutation(
    trpc.workflows.execute.mutationOptions({
      onSuccess: (data) => {
        toast.success(`Workflow "${data.name}" executed`);
      },
      onError: (error) => {
        toast.error(`Failed to execute workflow: ${error.message}`);
      },
    }),
  );
};

/**
 * Hook to run an in-editor test (AF-M2-08). Runs the current draft
 * (`mode: TEST`) and navigates to the resulting execution, whose node
 * traces show per-node status, output, and errors.
 */
export const useTestWorkflow = () => {
  const trpc = useTRPC();
  const router = useRouter();

  return useMutation(
    trpc.workflows.testRun.mutationOptions({
      onSuccess: (data) => {
        toast.success("Test run started");
        router.push(`/executions/${data.id}`);
      },
      onError: (error) => {
        toast.error(`Test run failed: ${error.message}`);
      },
    }),
  );
};
