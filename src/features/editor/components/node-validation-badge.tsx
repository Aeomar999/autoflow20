"use client";

import { useAtomValue } from "jotai";
import { AlertCircleIcon, TriangleAlertIcon } from "lucide-react";
import { memo } from "react";
import { cn } from "@/lib/utils";
import { validationResultAtom } from "../store/atoms";

/**
 * AF-M1-07 — corner badge on a canvas node showing its current lint status,
 * hovered for a tooltip listing each issue. Renders nothing while the node is
 * clean. The lint itself runs once per graph in the shared validator (`@/engine/validate`);
 * this reads the derived result atom.
 */
export const NodeValidationBadge = memo(function NodeValidationBadge({
  nodeId,
}: {
  nodeId: string;
}) {
  const result = useAtomValue(validationResultAtom);
  const issues = result.errors.filter((issue) => issue.nodeId === nodeId);
  if (issues.length === 0) return null;

  const hasErrors = issues.some((issue) => issue.severity === "error");
  const Icon = hasErrors ? AlertCircleIcon : TriangleAlertIcon;

  return (
    <span className="group/badge absolute -top-2 -right-2 z-10">
      <Icon
        className={cn(
          "size-4 rounded-full bg-background ring-2 ring-background",
          hasErrors ? "text-danger" : "text-warning",
        )}
      />
      <span className="pointer-events-none absolute right-0 top-full z-10 mt-2 w-56 rounded-md border bg-popover p-3 text-xs opacity-0 shadow-md transition-opacity group-hover/badge:opacity-100">
        <ul className="flex flex-col gap-1.5">
          {issues.map((issue) => {
            const isError = issue.severity === "error";
            return (
              <li key={`${issue.nodeId}.${issue.path ?? ""}.${issue.message}`}>
                <span
                  className={cn(
                    "font-medium capitalize",
                    isError ? "text-danger" : "text-warning",
                  )}
                >
                  {issue.severity}
                </span>{" "}
                {issue.path ? `${issue.path}: ` : ""}
                {issue.message}
              </li>
            );
          })}
        </ul>
      </span>
    </span>
  );
});

NodeValidationBadge.displayName = "NodeValidationBadge";
