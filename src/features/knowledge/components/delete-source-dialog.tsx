"use client";

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
import { useRemoveSource } from "../hooks/use-knowledge-sources";

interface DeleteSourceDialogProps {
  sourceId: string;
  sourceName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DeleteSourceDialog({
  sourceId,
  sourceName,
  open,
  onOpenChange,
}: DeleteSourceDialogProps) {
  const removeMutation = useRemoveSource();

  const handleDelete = async () => {
    await removeMutation.mutateAsync({ id: sourceId });
    onOpenChange(false);
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Knowledge Source</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete <strong>{sourceName}</strong>? All
            associated text chunks and vector embeddings will be permanently
            removed from pgvector.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={removeMutation.isPending}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={removeMutation.isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {removeMutation.isPending ? "Deleting..." : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
