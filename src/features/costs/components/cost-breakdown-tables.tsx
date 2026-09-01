"use client";

import { formatDistanceToNow } from "date-fns";
import Link from "next/link";

import {
  DataTable,
  TableEmpty,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/components/dashboard/data-table";
import {
  Panel,
  PanelBody,
  PanelEmpty,
  PanelHeader,
  PanelTitle,
} from "@/components/dashboard/panel";
import { ExecutionStatusPill } from "@/features/executions/lib/status";

import { shareOfTotal } from "../lib/aggregate";
import { formatPercent, formatTokens, formatUsd } from "../lib/format";
import type { ModelCostRow, RunCostRow, WorkflowCostRow } from "../lib/types";

/** Share-of-spend bar; the width is the row's fraction of the period total. */
const ShareBar = ({ fraction }: { fraction: number }) => (
  <div className="h-1 w-full overflow-hidden rounded-full bg-well">
    <div
      className="h-1 rounded-full bg-primary"
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
  <Panel>
    <PanelHeader>
      <PanelTitle hint="The workflows spending the most in this window.">
        Cost per workflow
      </PanelTitle>
      {rows.length > 0 ? (
        <span className="text-xs text-muted-foreground tabular-nums">
          {rows.length} shown
        </span>
      ) : null}
    </PanelHeader>

    {rows.length === 0 ? (
      <PanelEmpty>No workflow has recorded spend yet.</PanelEmpty>
    ) : (
      <PanelBody className="space-y-3.5">
        {rows.map((row) => {
          const share = shareOfTotal(row.costUsd, totalUsd);
          return (
            <div key={row.workflowId} className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <Link
                  href={`/workflows/${row.workflowId}`}
                  className="truncate text-sm hover:text-primary hover:underline"
                >
                  {row.name}
                </Link>
                <span className="shrink-0 font-mono text-sm tabular-nums">
                  {formatUsd(row.costUsd)}
                </span>
              </div>
              <ShareBar fraction={share} />
              <div className="flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
                <span>
                  {row.runs} {row.runs === 1 ? "run" : "runs"},{" "}
                  {formatTokens(row.tokensIn + row.tokensOut)} tokens
                </span>
                <span className="shrink-0 tabular-nums">
                  {formatPercent(share)} of spend
                </span>
              </div>
            </div>
          );
        })}
      </PanelBody>
    )}
  </Panel>
);

export const ModelCostTable = ({
  rows,
  totalUsd,
}: {
  rows: ModelCostRow[];
  totalUsd: number;
}) => (
  <Panel>
    <PanelHeader>
      <PanelTitle hint="Attributed to the model that actually served each node, including fallbacks.">
        Cost per model
      </PanelTitle>
      {rows.length > 0 ? (
        <span className="text-xs text-muted-foreground tabular-nums">
          {rows.length} shown
        </span>
      ) : null}
    </PanelHeader>

    {rows.length === 0 ? (
      <PanelEmpty>No AI node has recorded a served model yet.</PanelEmpty>
    ) : (
      <PanelBody className="space-y-3.5">
        {rows.map((row) => {
          const share = shareOfTotal(row.costUsd, totalUsd);
          return (
            <div key={row.model} className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate font-mono text-sm">{row.model}</span>
                <span className="shrink-0 font-mono text-sm tabular-nums">
                  {formatUsd(row.costUsd)}
                </span>
              </div>
              <ShareBar fraction={share} />
              <div className="flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
                <span>
                  {row.nodeRuns} {row.nodeRuns === 1 ? "node run" : "node runs"}
                </span>
                <span className="shrink-0 tabular-nums">
                  {formatTokens(row.tokensIn)} in /{" "}
                  {formatTokens(row.tokensOut)} out
                </span>
              </div>
            </div>
          );
        })}
      </PanelBody>
    )}
  </Panel>
);

export const RunCostTable = ({ rows }: { rows: RunCostRow[] }) => (
  <Panel>
    <PanelHeader>
      <PanelTitle hint="Open a run to see which node spent the money.">
        Most expensive runs
      </PanelTitle>
      {rows.length > 0 ? (
        <span className="text-xs text-muted-foreground tabular-nums">
          {rows.length} shown
        </span>
      ) : null}
    </PanelHeader>

    <DataTable>
      <THead>
        <tr>
          <TH>Workflow</TH>
          <TH>Status</TH>
          <TH className="hidden md:table-cell">Started</TH>
          <TH align="right" className="hidden sm:table-cell">
            Tokens
          </TH>
          <TH align="right">Cost</TH>
        </tr>
      </THead>
      <TBody>
        {rows.length === 0 ? (
          <TableEmpty colSpan={5}>
            No run in this window has recorded a cost.
          </TableEmpty>
        ) : (
          rows.map((row) => (
            <TR key={row.executionId} href={`/executions/${row.executionId}`}>
              <TD className="max-w-[220px]">
                <Link
                  href={`/executions/${row.executionId}`}
                  className="block truncate font-medium hover:text-primary hover:underline"
                >
                  {row.workflowName}
                </Link>
              </TD>
              <TD>
                <ExecutionStatusPill status={row.status} />
              </TD>
              <TD className="hidden text-muted-foreground md:table-cell">
                {formatDistanceToNow(row.startedAt, { addSuffix: true })}
              </TD>
              <TD
                align="right"
                className="hidden font-mono text-muted-foreground tabular-nums sm:table-cell"
              >
                {formatTokens(row.tokensIn + row.tokensOut)}
              </TD>
              <TD align="right" className="font-mono font-medium tabular-nums">
                {formatUsd(row.costUsd)}
              </TD>
            </TR>
          ))
        )}
      </TBody>
    </DataTable>
  </Panel>
);
