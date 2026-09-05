"use client";

import { useAtomValue, useSetAtom, useStore } from "jotai";
import { SaveIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { formatLastSaved } from "@/features/editor/lib/format-last-saved";
import {
  edgesAtom,
  lastSavedAtAtom,
  nodesAtom,
  saveStatusAtom,
} from "@/features/editor/store/atoms";
import {
  useSaveWorkflow,
  useSuspenseWorkflow,
  useUpdateWorkflowName,
} from "@/features/workflows/hooks/use-workflows";

function useDebounce(callback: () => void, delayMs: number) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  const cancel = useCallback(() => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: callback is stored in ref but must trigger re-run to restart timer
  useEffect(() => {
    timeoutRef.current = setTimeout(() => {
      callbackRef.current();
      timeoutRef.current = null;
    }, delayMs);
    return cancel;
  }, [callback, delayMs, cancel]);

  return cancel;
}

export const EditorSaveButton = ({ workflowId }: { workflowId: string }) => {
  const { data: workflow } = useSuspenseWorkflow(workflowId);
  const saveWorkflow = useSaveWorkflow();
  const saveStatus = useAtomValue(saveStatusAtom);
  const setSaveStatus = useSetAtom(saveStatusAtom);
  const lastSavedAt = useAtomValue(lastSavedAtAtom);
  const store = useStore();
  const [now, setNow] = useState(() => Date.now());

  // Read nodes/edges lazily inside save — avoids subscribing to these
  // high-frequency atoms at render time, which would re-render this
  // component on every drag tick and restart the autosave debounce.
  const performSave = useCallback(
    (manual: boolean) => {
      if (saveStatus === "saving") return;
      if (typeof workflow.revision !== "number") return;

      // Lazy read: get current atom values at save time, not render time.
      const nodes = store.get(nodesAtom);
      const edges = store.get(edgesAtom);

      setSaveStatus("saving");
      saveWorkflow.mutate(
        {
          id: workflowId,
          nodes: nodes.filter(
            (n): n is typeof n & { type: string } => !!n.type,
          ),
          edges,
          revision: workflow.revision,
        },
        // Toast only the explicit Save click — the 1.5s debounced autosave
        // runs on every drag tick and must stay silent (AF-UX-03).
        manual ? { onSuccess: () => toast.success("Workflow saved") } : {},
      );
    },
    [
      saveWorkflow,
      workflowId,
      workflow.revision,
      saveStatus,
      setSaveStatus,
      store,
    ],
  );

  // Debounced autosave: triggers 1.5s after last change.
  const cancelAutosave = useDebounce(
    useCallback(() => {
      if (saveStatus === "unsaved") {
        performSave(false);
      }
    }, [saveStatus, performSave]),
    1500,
  );

  // beforeunload warning when dirty.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (saveStatus === "unsaved" || saveStatus === "failed") {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [saveStatus]);

  // Tick the relative "Last saved" time only while the save is committed.
  useEffect(() => {
    if (saveStatus !== "saved") return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, [saveStatus]);

  const handleSave = () => {
    cancelAutosave();
    performSave(true);
  };

  return (
    <div className="ml-auto flex items-center gap-2">
      {saveStatus === "saved" && lastSavedAt !== null && (
        <span className="text-xs text-muted-foreground tabular-nums">
          Last saved: {formatLastSaved(lastSavedAt, now)}
        </span>
      )}
      {saveStatus === "failed" && (
        <span className="text-xs text-destructive">Save failed</span>
      )}
      <Button size="sm" onClick={handleSave} disabled={saveStatus === "saving"}>
        <SaveIcon className="size-4" />
        {saveStatus === "saving" ? "Saving..." : "Save"}
      </Button>
    </div>
  );
};

export const EditorNameInput = ({ workflowId }: { workflowId: string }) => {
  const { data: workflow } = useSuspenseWorkflow(workflowId);
  const updateWorkflow = useUpdateWorkflowName();

  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(workflow.name);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (workflow.name) {
      setName(workflow.name);
    }
  }, [workflow.name]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleSave = async () => {
    if (name === workflow.name) {
      setIsEditing(false);
      return;
    }

    try {
      await updateWorkflow.mutateAsync({
        id: workflowId,
        name,
      });
    } catch {
      setName(workflow.name);
    } finally {
      setIsEditing(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSave();
    } else if (e.key === "Escape") {
      setName(workflow.name);
      setIsEditing(false);
    }
  };

  if (isEditing) {
    return (
      <Input
        disabled={updateWorkflow.isPending}
        ref={inputRef}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={handleSave}
        onKeyDown={handleKeyDown}
        className="h-7 w-auto min-w-[100px] px-2"
      />
    );
  }

  return (
    <BreadcrumbItem
      onClick={() => setIsEditing(true)}
      className="cursor-pointer hover:text-foreground transition-colors"
    >
      {workflow.name}
    </BreadcrumbItem>
  );
};

export const EditorBreadcrumbs = ({ workflowId }: { workflowId: string }) => {
  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link prefetch href="/workflows">
              Workflows
            </Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <EditorNameInput workflowId={workflowId} />
      </BreadcrumbList>
    </Breadcrumb>
  );
};

import { VersionHistorySheet } from "@/features/workflows/components/version-history";

export const EditorHeader = ({ workflowId }: { workflowId: string }) => {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4 bg-background">
      <SidebarTrigger />
      <div className="flex flex-row items-center justify-between gap-x-4 w-full">
        <EditorBreadcrumbs workflowId={workflowId} />
        <div className="flex items-center gap-2">
          <VersionHistorySheet workflowId={workflowId} />
          <EditorSaveButton workflowId={workflowId} />
        </div>
      </div>
    </header>
  );
};
