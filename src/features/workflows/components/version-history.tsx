"use client";

import { formatDistanceToNow } from "date-fns";
import { CheckCircle2Icon, HistoryIcon } from "lucide-react";
import type { ReactNode } from "react";
import { StatusPill } from "@/components/dashboard/status-pill";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  useActivateVersion,
  useDeactivateWorkflow,
  usePublishWorkflow,
  useWorkflowVersions,
} from "../hooks/use-workflows";

// Diff utility
type VersionSnapshot = {
  nodes?: Array<{ id: string; type: string }>;
};

function getDiffSummary(
  currentSnapshot: VersionSnapshot | null | undefined,
  previousSnapshot: VersionSnapshot | null | undefined,
): ReactNode {
  if (!currentSnapshot?.nodes) return null;
  const currentNodes = currentSnapshot.nodes;
  const prevNodes = previousSnapshot?.nodes ?? [];

  const currentTypes = currentNodes.reduce(
    (acc, n) => {
      acc[n.type] = (acc[n.type] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  const prevTypes = prevNodes.reduce(
    (acc, n) => {
      acc[n.type] = (acc[n.type] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  const added: string[] = [];
  const removed: string[] = [];

  const allTypes = new Set([
    ...Object.keys(currentTypes),
    ...Object.keys(prevTypes),
  ]);

  for (const type of Array.from(allTypes)) {
    const countCur = currentTypes[type] || 0;
    const countPrev = prevTypes[type] || 0;
    if (countCur > countPrev) {
      added.push(`${countCur - countPrev} ${type}`);
    } else if (countPrev > countCur) {
      removed.push(`${countPrev - countCur} ${type}`);
    }
  }

  if (added.length === 0 && removed.length === 0) {
    return "No structural changes";
  }

  return (
    <div className="flex flex-col gap-1 text-xs mt-2">
      {added.length > 0 && (
        <span className="text-success">+ {added.join(", ")}</span>
      )}
      {removed.length > 0 && (
        <span className="text-danger">- {removed.join(", ")}</span>
      )}
    </div>
  );
}

export const VersionHistorySheet = ({ workflowId }: { workflowId: string }) => {
  const { data, isLoading } = useWorkflowVersions(workflowId);
  const activate = useActivateVersion();
  const deactivate = useDeactivateWorkflow();
  const publish = usePublishWorkflow();

  const versions = data?.versions || [];
  const activeId = data?.activeVersionId;

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <HistoryIcon className="size-4" />
          History
        </Button>
      </SheetTrigger>
      <SheetContent className="w-[400px] sm:w-[540px] flex flex-col">
        <SheetHeader>
          <SheetTitle>Version History</SheetTitle>
          <SheetDescription>
            View published versions and roll back if needed.
          </SheetDescription>
        </SheetHeader>

        <div className="flex items-center justify-between gap-4 border-b border-hairline py-4">
          <div>
            <h4 className="text-sm font-medium">Publish Draft</h4>
            <p className="text-sm text-muted-foreground">
              Make your current draft the active version.
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => publish.mutate({ id: workflowId, activate: true })}
            disabled={publish.isPending}
          >
            Publish Now
          </Button>
        </div>

        <ScrollArea className="flex-1 -mx-6 px-6">
          {isLoading && (
            <p className="text-sm text-muted-foreground mt-4">
              Loading versions...
            </p>
          )}
          {!isLoading && versions.length === 0 && (
            <p className="text-sm text-muted-foreground mt-4">
              No published versions yet.
            </p>
          )}

          <div className="flex flex-col gap-4 py-4">
            {versions.map((v, index) => {
              const previousVersion = versions[index + 1];
              const isActive = v.id === activeId;
              const diffNode = getDiffSummary(
                v.graphSnapshot as VersionSnapshot,
                previousVersion?.graphSnapshot as VersionSnapshot | undefined,
              );

              return (
                <div
                  key={v.id}
                  className={`flex flex-col gap-3 rounded-lg border p-4 ${isActive ? "border-primary/25 bg-primary/8" : "border-hairline bg-panel"}`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">v{v.version}</span>
                        {isActive ? (
                          <StatusPill
                            tone="success"
                            icon={<CheckCircle2Icon />}
                          >
                            Active
                          </StatusPill>
                        ) : (
                          <StatusPill tone="neutral">Inactive</StatusPill>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {formatDistanceToNow(new Date(v.createdAt), {
                          addSuffix: true,
                        })}
                      </p>
                    </div>
                    <div>
                      {isActive ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => deactivate.mutate({ id: workflowId })}
                          disabled={deactivate.isPending}
                        >
                          Deactivate
                        </Button>
                      ) : (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() =>
                            activate.mutate({ workflowId, versionId: v.id })
                          }
                          disabled={activate.isPending}
                        >
                          Rollback to v{v.version}
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="rounded-md border border-hairline bg-well p-2.5">
                    <p className="dash-label mb-1.5 text-muted-foreground">
                      Changes in this version
                    </p>
                    {typeof diffNode === "string" ? (
                      <p className="text-xs text-muted-foreground">
                        {diffNode}
                      </p>
                    ) : (
                      diffNode
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
};
