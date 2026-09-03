"use client";

import { format } from "date-fns";
import { ChevronRightIcon, ScrollTextIcon } from "lucide-react";
import { useState } from "react";

import {
  DataTable,
  TableEmpty,
  TableSkeleton,
  TBody,
  TD,
  TH,
  THead,
} from "@/components/dashboard/data-table";
import { Panel, PanelHeader, PanelTitle } from "@/components/dashboard/panel";
import {
  EmptyView,
  EntityPagination,
  ErrorView,
} from "@/components/entity-components";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

import { useAuditLogs } from "../hooks/use-organizations";

const COLUMNS = 5;

/** `resourceType` values the app actually writes, for the filter dropdown. */
const RESOURCE_TYPES = [
  "workflow",
  "credential",
  "execution",
  "organization",
  "member",
  "invitation",
  "apiKey",
  "template",
  "knowledgeSource",
] as const;

const ALL = "__all__";

type AuditRow = {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string;
  actorType: string;
  actor: { id: string; name: string; email: string } | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  createdAt: Date;
};

/**
 * The audit-log viewer (AF-M6-05).
 *
 * `logAuditEvent` and its append-only writes shipped in M6 and have been
 * recording every mutation since — with no way to read them short of database
 * access, which for an audit trail is most of the point. This is the reader.
 *
 * Rows expand to show the `before`/`after` JSON rather than opening a detail
 * route: an audit entry is only meaningful next to its neighbours, and
 * navigating away to inspect one loses the sequence you were reading.
 */
export const AuditLogList = () => {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState("");
  const [resourceType, setResourceType] = useState<string>(ALL);

  const logs = useAuditLogs({
    page,
    action: action.trim() || undefined,
    resourceType: resourceType === ALL ? undefined : resourceType,
  });

  // Any filter change invalidates the current page number — page 4 of an
  // unfiltered log is rarely page 4 of a filtered one, and silently keeping it
  // shows an empty table for a filter that has plenty of matches.
  const changeFilter = (apply: () => void) => {
    apply();
    setPage(1);
  };

  if (logs.isError) {
    return (
      <ErrorView message="Could not load the audit log. It is admin-only — check your role if this persists." />
    );
  }

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>
          Audit log
          {logs.data ? (
            <span className="ml-2 text-xs font-normal text-muted-foreground tabular-nums">
              {logs.data.totalCount}
            </span>
          ) : null}
        </PanelTitle>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            className="h-8 w-full border-hairline bg-well text-sm shadow-none sm:w-44"
            placeholder="Filter by action"
            value={action}
            onChange={(event) =>
              changeFilter(() => setAction(event.target.value))
            }
          />
          <Select
            value={resourceType}
            onValueChange={(next) => changeFilter(() => setResourceType(next))}
          >
            <SelectTrigger className="h-8 w-full border-hairline bg-well text-sm shadow-none sm:w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All resources</SelectItem>
              {RESOURCE_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {type}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </PanelHeader>

      <DataTable>
        <THead>
          <tr>
            <TH className="w-8">
              <span className="sr-only">Expand</span>
            </TH>
            <TH>Action</TH>
            <TH className="hidden sm:table-cell">Resource</TH>
            <TH className="hidden md:table-cell">Actor</TH>
            <TH align="right">When</TH>
          </tr>
        </THead>
        <TBody>
          {logs.isLoading ? (
            <TableSkeleton columns={COLUMNS} rows={6} />
          ) : !logs.data || logs.data.items.length === 0 ? (
            <TableEmpty colSpan={COLUMNS}>
              <EmptyView
                icon={ScrollTextIcon}
                title={
                  action || resourceType !== ALL
                    ? "No entries match those filters"
                    : "Nothing recorded yet"
                }
                message={
                  action || resourceType !== ALL
                    ? "Clear the filters to see the whole log."
                    : "Every change to a workflow, credential or member is recorded here as it happens."
                }
              />
            </TableEmpty>
          ) : (
            logs.data.items.map((entry) => (
              <AuditRowView key={entry.id} entry={entry as AuditRow} />
            ))
          )}
        </TBody>
      </DataTable>

      {logs.data && logs.data.totalPages > 1 ? (
        <EntityPagination
          page={logs.data.page}
          totalPages={logs.data.totalPages}
          onPageChange={setPage}
          disabled={logs.isFetching}
        />
      ) : null}
    </Panel>
  );
};

const AuditRowView = ({ entry }: { entry: AuditRow }) => {
  const [open, setOpen] = useState(false);
  const hasDiff = entry.before != null || entry.after != null;

  return (
    <>
      <tr
        className={cn(
          "border-b border-hairline transition-colors last:border-b-0",
          hasDiff ? "cursor-pointer hover:bg-well" : "hover:bg-well/60",
        )}
        onClick={hasDiff ? () => setOpen((prev) => !prev) : undefined}
      >
        <TD>
          {hasDiff ? (
            <button
              type="button"
              aria-label={open ? "Hide changes" : "Show changes"}
              aria-expanded={open}
              className="flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
              onClick={(event) => {
                event.stopPropagation();
                setOpen((prev) => !prev);
              }}
            >
              <ChevronRightIcon
                className={cn(
                  "size-3.5 transition-transform",
                  open && "rotate-90",
                )}
              />
            </button>
          ) : null}
        </TD>
        <TD>
          <span className="font-mono text-xs">{entry.action}</span>
        </TD>
        <TD className="hidden sm:table-cell">
          <div className="flex min-w-0 flex-col">
            <Badge variant="outline" className="w-fit font-normal">
              {entry.resourceType}
            </Badge>
            <span className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
              {entry.resourceId}
            </span>
          </div>
        </TD>
        <TD className="hidden md:table-cell">
          {entry.actor ? (
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm">{entry.actor.name}</span>
              <span className="truncate text-[11px] text-muted-foreground">
                {entry.actor.email}
              </span>
            </div>
          ) : (
            // A null actor is not missing data: `actorId` is `onDelete:
            // SetNull`, so entries outlive the user who made them, and
            // system-initiated writes have no actor at all. Say which.
            <span className="text-xs text-muted-foreground">
              {entry.actorType === "USER" ? "Deleted user" : entry.actorType}
            </span>
          )}
        </TD>
        <TD align="right">
          <span
            className="text-xs text-muted-foreground tabular-nums"
            title={new Date(entry.createdAt).toISOString()}
          >
            {format(new Date(entry.createdAt), "d MMM yyyy HH:mm:ss")}
          </span>
        </TD>
      </tr>

      {open ? (
        <tr className="border-b border-hairline bg-well/50 last:border-b-0">
          <td colSpan={COLUMNS} className="px-4 py-3">
            <div className="grid gap-3 md:grid-cols-2">
              <JsonPane label="Before" value={entry.before} />
              <JsonPane label="After" value={entry.after} />
            </div>
            {entry.ip ? (
              <p className="mt-3 text-[11px] text-muted-foreground">
                From {entry.ip}
              </p>
            ) : null}
          </td>
        </tr>
      ) : null}
    </>
  );
};

const JsonPane = ({ label, value }: { label: string; value: unknown }) => (
  <div className="min-w-0">
    <p className="mb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
      {label}
    </p>
    {value == null ? (
      <p className="rounded-md border border-hairline bg-panel px-3 py-2 text-xs text-muted-foreground">
        {label === "Before" ? "Created — no prior state" : "No state recorded"}
      </p>
    ) : (
      // `overflow-x-auto` on the pre, not the page: an audit payload can carry
      // a long single-line value, and a horizontally scrolling document is
      // worse than a horizontally scrolling code block.
      <pre className="max-h-64 overflow-auto rounded-md border border-hairline bg-panel px-3 py-2 font-mono text-[11px] leading-relaxed">
        {JSON.stringify(value, null, 2)}
      </pre>
    )}
  </div>
);
