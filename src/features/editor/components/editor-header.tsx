"use client";

import { getDefaultStore, useAtomValue, useSetAtom } from "jotai";
import { SaveIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
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
import {
  edgesAtom,
  nodesAtom,
  saveStatusAtom,
} from "@/features/editor/store/atoms";
import {
  useSaveWorkflow,
  useSuspenseWorkflow,
  useUpdateWorkflowName,
} from "@/features/workflows/hooks/use-workflows";

const jotaiStore = getDefaultStore();

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

  // Read nodes/edges lazily inside save — avoids subscribing to these
  // high-frequency atoms at render time, which would re-render this
  // component on every drag tick and restart the autosave debounce.
  const performSave = useCallback(() => {
    if (saveStatus === "saving") return;
    if (typeof workflow.revision !== "number") return;

    // Lazy read: get current atom values at save time, not render time.
    const nodes = jotaiStore.get(nodesAtom);
    const edges = jotaiStore.get(edgesAtom);

    setSaveStatus("saving");
    saveWorkflow.mutate({
      id: workflowId,
      nodes: nodes.filter((n): n is typeof n & { type: string } => !!n.type),
      edges,
      revision: workflow.revision,
    });
  }, [saveWorkflow, workflowId, workflow.revision, saveStatus, setSaveStatus]);

  // Debounced autosave: triggers 1.5s after last change.
  const cancelAutosave = useDebounce(
    useCallback(() => {
      if (saveStatus === "unsaved") {
        performSave();
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

  const handleSave = () => {
    cancelAutosave();
    performSave();
  };

  const statusLabel =
    saveStatus === "saved"
      ? "Saved"
      : saveStatus === "saving"
        ? "Saving..."
        : saveStatus === "failed"
          ? "Save failed"
          : "";

  return (
    <div className="ml-auto flex items-center gap-2">
      {saveStatus !== "unsaved" && saveStatus !== "saving" && (
        <span className="text-xs text-muted-foreground">{statusLabel}</span>
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

export const EditorHeader = ({ workflowId }: { workflowId: string }) => {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4 bg-background">
      <SidebarTrigger />
      <div className="flex flex-row items-center justify-between gap-x-4 w-full">
        <EditorBreadcrumbs workflowId={workflowId} />
        <EditorSaveButton workflowId={workflowId} />
      </div>
    </header>
  );
};
