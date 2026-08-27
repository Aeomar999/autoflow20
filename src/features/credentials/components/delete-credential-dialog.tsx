"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  useCredentialUsage,
  useRemoveCredential,
} from "../hooks/use-credentials";

interface DeleteCredentialDialogProps {
  credentialId: string;
  credentialName: string;
  usageCount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Navigate to /credentials on success (edit page) vs stay in list. */
  navigateOnDelete?: boolean;
}

/**
 * Confirmation dialog for credential deletion. When the credential is in use
 * by workflows, fetches and displays the affected workflow names as a warning.
 */
export function DeleteCredentialDialog({
  credentialId,
  credentialName,
  usageCount,
  open,
  onOpenChange,
  navigateOnDelete = false,
}: DeleteCredentialDialogProps) {
  const router = useRouter();
  const removeCredential = useRemoveCredential();
  const usageQuery = useCredentialUsage(credentialId, open && usageCount > 0);

  const handleDelete = async () => {
    await removeCredential.mutateAsync({ id: credentialId });
    onOpenChange(false);
    if (navigateOnDelete) {
      router.push("/credentials");
    }
  };

  const isInUse = usageCount > 0;
  const workflows = usageQuery.data?.workflows ?? [];

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Delete &ldquo;{credentialName}&rdquo;?
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              {isInUse ? (
                <>
                  <p>
                    This credential is used by{" "}
                    <strong>
                      {usageCount} workflow{usageCount !== 1 ? "s" : ""}
                    </strong>
                    . Removing it will disconnect those nodes, and affected
                    workflows may fail on their next run.
                  </p>
                  {usageQuery.isLoading ? (
                    <div className="flex items-center gap-2 text-muted-foreground text-sm">
                      <Loader2 className="size-4 animate-spin" />
                      Loading affected workflows…
                    </div>
                  ) : (
                    workflows.length > 0 && (
                      <ul className="list-disc pl-5 space-y-1 text-sm">
                        {workflows.map((workflow) => (
                          <li key={workflow.id}>
                            <Link
                              href={`/workflows/${workflow.id}`}
                              className="underline hover:no-underline"
                              onClick={(event) => event.stopPropagation()}
                            >
                              {workflow.name}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )
                  )}
                </>
              ) : (
                <p>
                  This action cannot be undone. The credential and its encrypted
                  data will be permanently deleted.
                </p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={removeCredential.isPending}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={removeCredential.isPending}
            className={cn(buttonVariants({ variant: "destructive" }))}
          >
            {removeCredential.isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Deleting…
              </>
            ) : (
              "Delete"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
