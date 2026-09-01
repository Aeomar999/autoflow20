"use client";

import { Panel, useReactFlow } from "@xyflow/react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  AlertCircleIcon,
  ChevronDownIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { memo, useCallback, useState } from "react";
import { cn } from "@/lib/utils";
import {
  nodesAtom,
  selectedNodeIdAtom,
  validationResultAtom,
} from "../store/atoms";

/**
 * AF-M1-07 — collapsible summary of every canvas lint error/warning. Node-level
 * rows click-to-focus the offending node; graph-level rows (e.g. "no trigger")
 * are informational only. Rendered by <Editor /> inside <ReactFlow />; hidden
 * entirely while the draft is clean.
 */
export const ValidationPanel = memo(function ValidationPanel() {
  const result = useAtomValue(validationResultAtom);
  const nodes = useAtomValue(nodesAtom);
  const setSelectedNodeId = useSetAtom(selectedNodeIdAtom);
  const { getNode, setCenter } = useReactFlow();
  const [open, setOpen] = useState(false);

  const selectNode = useCallback(
    (nodeId: string) => {
      const node = getNode(nodeId);
      if (!node) return;
      setSelectedNodeId(nodeId);
      setCenter(node.position.x, node.position.y, {
        zoom: 1.2,
        duration: 500,
      });
    },
    [getNode, setSelectedNodeId, setCenter],
  );

  const errors = result.errors;
  if (errors.length === 0) return null;

  const errorCount = errors.filter(
    (issue) => issue.severity === "error",
  ).length;
  const warningCount = errors.length - errorCount;
  const status = errorCount > 0 ? "error" : "warning";

  return (
    <Panel position="top-left">
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className={cn(
            "flex cursor-pointer items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-xs font-semibold shadow-md",
            status === "error" ? "text-danger" : "text-warning",
          )}
        >
          <span>
            {errorCount} error{errorCount === 1 ? "" : "s"} · {warningCount}{" "}
            warning{warningCount === 1 ? "" : "s"}
          </span>
          <ChevronDownIcon
            className={cn(
              "size-3.5 transition-transform",
              open && "rotate-180",
            )}
          />
        </button>
        {open && (
          <ul className="max-h-64 w-80 overflow-y-auto rounded-md border bg-popover p-1.5 text-sm shadow-md">
            {errors.map((issue) => {
              const node = issue.nodeId
                ? nodes.find((n) => n.id === issue.nodeId)
                : undefined;
              const isError = issue.severity === "error";
              return (
                <li
                  key={`${issue.nodeId}.${issue.path ?? ""}.${issue.message}`}
                >
                  <button
                    type="button"
                    disabled={!issue.nodeId}
                    onClick={() => {
                      if (!issue.nodeId || !node) return;
                      selectNode(issue.nodeId);
                    }}
                    className="flex w-full cursor-pointer items-start gap-2 rounded-sm p-2 text-left hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
                  >
                    {isError ? (
                      <AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
                    ) : (
                      <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning" />
                    )}
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {node?.name ?? issue.nodeId ?? "Workflow"}
                        {issue.path ? ` · ${issue.path}` : ""}
                      </span>
                      <span className="block break-words text-xs text-muted-foreground">
                        {issue.message}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Panel>
  );
});

ValidationPanel.displayName = "ValidationPanel";
