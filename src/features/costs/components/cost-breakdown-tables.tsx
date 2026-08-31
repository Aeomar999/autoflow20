"use client";

import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { shareOfTotal } from "../lib/aggregate";
import { formatPercent, formatTokens, formatUsd } from "../lib/format";
import type { ModelCostRow, RunCostRow, WorkflowCostRow } from "../lib/types";

const EmptyRow = ({ message }: { message: string }) => (
  <p className="text-sm text-muted-foreground py-6 text-center">{message}</p>
);

/** Share-of-spend bar; the width is the row's fraction of the period total. */
const ShareBar = ({ fraction }: { fraction: number }) => (
  <div className="h-1.5 w-full rounded-full bg-muted">
    <div
      className="h-1.5 rounded-full bg-primary"
      style={{ width: `${Math.max(2, fraction * 100)}%` }}
    />
  </div>
);

export const WorkflowCostTable = ({
  rows,
  totalUsd,
}: {
  rows: WorkflowCostRow[];
  totalUsd: number;
}) => (
  <Card className="shadow-none">
    <CardHeader>
      <CardTitle className="text-base">Cost per workflow</CardTitle>
      <CardDescription>
        The workflows spending the most in this window.
      </CardDescription>
    </CardHeader>
    <CardContent className="space-y-3">
      {rows.length === 0 ? (
        <EmptyRow message="No workflow has recorded spend yet." />
      ) : (
        rows.map((row) => {
          const share = shareOfTotal(row.costUsd, totalUsd);
          return (
            <div key={row.workflowId} className="space-y-1">
              <div className="flex items-baseline justify-between gap-3">
                <Link
                  href={`/workflows/${row.workflowId}`}
                  className="text-sm truncate hover:underline"
                >
                  {row.name}
                </Link>
                <span className="text-sm font-mono tabular-nums shrink-0">
                  {formatUsd(row.costUsd)}
                </span>
              </div>
              <ShareBar fraction={share} />
              <p className="text-xs text-muted-foreground">
                {row.runs} {row.runs === 1 ? "run" : "runs"} ·{" "}
                {formatTokens(row.tokensIn + row.tokensOut)} tokens ·{" "}
                {formatPercent(share)} of spend
              </p>
            </div>
          );
        })
      )}
    </CardContent>
  </Card>
);

export const ModelCostTable = ({
  rows,
  totalUsd,
}: {
  rows: ModelCostRow[];
  totalUsd: number;
}) => (
  <Card className="shadow-none">
    <CardHeader>
      <CardTitle className="text-base">Cost per model</CardTitle>
      <CardDescription>
        Attributed to the model that actually served each node, including
        fallbacks.
      </CardDescription>
    </CardHeader>
    <CardContent className="space-y-3">
      {rows.length === 0 ? (
        <EmptyRow message="No AI node has recorded a served model yet." />
      ) : (
        rows.map((row) => {
          const share = shareOfTotal(row.costUsd, totalUsd);
          return (
            <div key={row.model} className="space-y-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-mono truncate">{row.model}</span>
                <span className="text-sm font-mono tabular-nums shrink-0">
                  {formatUsd(row.costUsd)}
                </span>
              </div>
              <ShareBar fraction={share} />
              <p className="text-xs text-muted-foreground">
                {row.nodeRuns} {row.nodeRuns === 1 ? "node run" : "node runs"} ·{" "}
                {formatTokens(row.tokensIn)} in / {formatTokens(row.tokensOut)}{" "}
                out
              </p>
            </div>
          );
        })
      )}
    </CardContent>
  </Card>
);

export const RunCostTable = ({ rows }: { rows: RunCostRow[] }) => (
  <Card className="shadow-none">
    <CardHeader>
      <CardTitle className="text-base">Most expensive runs</CardTitle>
      <CardDescription>
        Open a run to see which node spent the money.
      </CardDescription>
    </CardHeader>
    <CardContent className="divide-y">
      {rows.length === 0 ? (
        <EmptyRow message="No run in this window has recorded a cost." />
      ) : (
        rows.map((row) => (
          <Link
            key={row.executionId}
            href={`/executions/${row.executionId}`}
            className="flex items-center justify-between gap-3 py-2 hover:bg-muted/50 rounded-sm px-1 -mx-1"
          >
            <div className="min-w-0">
              <p className="text-sm truncate">{row.workflowName}</p>
              <p className="text-xs text-muted-foreground">
                {row.status.charAt(0) + row.status.slice(1).toLowerCase()} ·{" "}
                {formatDistanceToNow(row.startedAt, { addSuffix: true })} ·{" "}
                {formatTokens(row.tokensIn + row.tokensOut)} tokens
              </p>
            </div>
            <span className="text-sm font-mono tabular-nums shrink-0">
              {formatUsd(row.costUsd)}
            </span>
          </Link>
        ))
      )}
    </CardContent>
  </Card>
);
