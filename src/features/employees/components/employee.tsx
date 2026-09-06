"use client";

import { format, formatDistanceToNow } from "date-fns";
import { ArrowRightIcon, PencilIcon } from "lucide-react";
import { useState } from "react";

import { PageHeader } from "@/components/dashboard/page";
import {
  Fact,
  Panel,
  PanelBody,
  PanelEmpty,
  PanelFacts,
  PanelHeader,
  PanelTitle,
} from "@/components/dashboard/panel";
import { Button } from "@/components/ui/button";
import { buildStatusChain } from "@/features/employees/lib/status-chain";
import { cn } from "@/lib/utils";
import {
  useSuspenseEmployee,
  useSuspenseEmployeeTimeline,
} from "../hooks/use-employees";

import { EmployeeStatusPill, employeeStatusMeta } from "../lib/status";
import { EmployeeEditDialog } from "./employee-form";

const formatDate = (value: Date | string | null): string =>
  value === null ? "-" : format(new Date(value), "d MMM yyyy");

const formatDateTime = (value: Date | string): string =>
  format(new Date(value), "d MMM yyyy, HH:mm");

/**
 * The status chain as a rail, with the record's current position marked.
 *
 * Rendered from `EMPLOYEE_STATUSES` rather than from the timeline, so a
 * record shows the whole chain — including the phases still ahead of it —
 * instead of only where it has been.
 */
const StatusChain = ({ status }: { status: string }) => {
  const steps = buildStatusChain(status);

  return (
    <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-2">
      {steps.map((step, index) => {
        const meta = employeeStatusMeta(step.status);

        return (
          <li key={step.status} className="flex items-center gap-1.5">
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
                step.state === "current" &&
                  "border-primary/30 bg-primary/10 text-primary",
                step.state === "past" &&
                  "border-hairline bg-well text-foreground",
                step.state === "upcoming" &&
                  "border-hairline border-dashed bg-transparent text-muted-foreground",
              )}
              aria-current={step.state === "current" ? "step" : undefined}
            >
              {meta.label}
            </span>
            {index < steps.length - 1 ? (
              <ArrowRightIcon className="size-3 text-muted-foreground/50" />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
};

const TIMELINE_ACTION_LABELS: Record<string, string> = {
  "employee.created": "Record created",
  "employee.status_changed": "Status changed",
};

const EmployeeTimeline = ({ employeeId }: { employeeId: string }) => {
  const timeline = useSuspenseEmployeeTimeline(employeeId);
  const entries = timeline.data;

  if (entries.length === 0) {
    return (
      <PanelEmpty>
        No handoff has touched this record yet. Events appear here the moment a
        lifecycle workflow moves it.
      </PanelEmpty>
    );
  }

  return (
    <ol className="divide-y divide-hairline">
      {entries.map((entry) => (
        <li
          key={entry.id}
          className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3"
        >
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="text-sm font-medium">
              {TIMELINE_ACTION_LABELS[entry.action] ?? entry.action}
            </span>
            {entry.from ? (
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <EmployeeStatusPill status={entry.from} />
                <ArrowRightIcon className="size-3" />
              </span>
            ) : null}
            {entry.to ? <EmployeeStatusPill status={entry.to} /> : null}
          </div>
          <span
            className="text-xs text-muted-foreground tabular-nums"
            title={formatDateTime(entry.createdAt)}
          >
            {formatDistanceToNow(new Date(entry.createdAt), {
              addSuffix: true,
            })}
            {entry.actorType === "SYSTEM" ? " · workflow" : ""}
          </span>
        </li>
      ))}
    </ol>
  );
};

export const EmployeeView = ({ employeeId }: { employeeId: string }) => {
  const employee = useSuspenseEmployee(employeeId);
  const [editing, setEditing] = useState(false);
  const data = employee.data;

  return (
    <>
      <PageHeader
        title={data.fullName}
        backTo={{ href: "/employees", label: "Employees" }}
        badge={<EmployeeStatusPill status={data.status} />}
        description={
          <span className="font-mono text-xs">{data.employeeRef}</span>
        }
        actions={
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            <PencilIcon className="size-4" />
            Edit
          </Button>
        }
      />

      <Panel>
        <PanelHeader>
          <PanelTitle hint="Single-step, forward-only. Only the guarded handoff layer moves a record along it.">
            Lifecycle
          </PanelTitle>
        </PanelHeader>
        <PanelBody>
          <StatusChain status={data.status} />
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader>
          <PanelTitle>Details</PanelTitle>
        </PanelHeader>
        <PanelBody>
          <PanelFacts>
            <Fact label="Role">{data.role}</Fact>
            <Fact label="Department">{data.department ?? "-"}</Fact>
            <Fact label="Work email">{data.email}</Fact>
            <Fact label="Manager">{data.managerEmail ?? "-"}</Fact>
            <Fact label="Personal email">{data.personalEmail ?? "-"}</Fact>
            <Fact label="Source">{data.source}</Fact>
            <Fact label="Start date">{formatDate(data.startDate)}</Fact>
            <Fact label="Offer signed">{formatDate(data.offerSignedAt)}</Fact>
            <Fact label="Active since">{formatDate(data.activeAt)}</Fact>
            <Fact label="Exit date">{formatDate(data.exitDate)}</Fact>
            <Fact label="Exit reason" className="sm:col-span-2">
              <span className="whitespace-normal">
                {data.exitReason ?? "-"}
              </span>
            </Fact>
            <Fact label="Created">{formatDate(data.createdAt)}</Fact>
          </PanelFacts>
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader>
          <PanelTitle hint="Read from the audit log — the same rows every guarded handoff writes.">
            Handoff history
          </PanelTitle>
        </PanelHeader>
        <EmployeeTimeline employeeId={employeeId} />
      </Panel>

      <EmployeeEditDialog
        employee={data}
        open={editing}
        onOpenChange={setEditing}
      />
    </>
  );
};
