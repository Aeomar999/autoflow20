"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BellIcon, BellOffIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { useSuspenseWorkflow } from "@/features/workflows/hooks/use-workflows";
import { useTRPC } from "@/trpc/client";

/**
 * Per-workflow notification delivery (AF-M7-08).
 *
 * Placed beside the run controls (design decision locked 2026-08-30): the
 * moment you are about to run something is the moment you have an opinion
 * about being told how it went.
 */
export const NotificationPrefsToggle = ({
  workflowId,
}: {
  workflowId: string;
}) => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { data: workflow } = useSuspenseWorkflow(workflowId);

  const update = useMutation(
    trpc.workflows.updateNotificationPrefs.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries(
          trpc.workflows.getOne.queryFilter({ id: workflowId }),
        );
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const notifyOnFailure = workflow.notifyOnFailure;
  const notifyOnSuccess = workflow.notifyOnSuccess;
  const anyOn = notifyOnFailure || notifyOnSuccess;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="size-9"
          aria-label="Notification settings for this workflow"
          title="Notification settings for this workflow"
        >
          {anyOn ? (
            <BellIcon className="size-4" />
          ) : (
            <BellOffIcon className="size-4 text-muted-foreground" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="center" className="w-72">
        <p className="text-sm font-medium">Notify this workspace</p>
        <p className="mt-1 text-xs text-muted-foreground">
          In-app only. Everyone who can see this workspace sees them.
        </p>

        <div className="mt-4 flex items-start justify-between gap-4">
          <label htmlFor="notify-failure" className="text-sm">
            When a run fails
            <span className="block text-xs text-muted-foreground">
              Recommended
            </span>
          </label>
          <Switch
            id="notify-failure"
            checked={notifyOnFailure}
            disabled={update.isPending}
            onCheckedChange={(checked) =>
              update.mutate({ id: workflowId, notifyOnFailure: checked })
            }
          />
        </div>

        <div className="mt-3 flex items-start justify-between gap-4">
          <label htmlFor="notify-success" className="text-sm">
            When a run succeeds
            <span className="block text-xs text-muted-foreground">
              Off by default — a frequent schedule would flood the centre.
            </span>
          </label>
          <Switch
            id="notify-success"
            checked={notifyOnSuccess}
            disabled={update.isPending}
            onCheckedChange={(checked) =>
              update.mutate({ id: workflowId, notifyOnSuccess: checked })
            }
          />
        </div>
      </PopoverContent>
    </Popover>
  );
};
