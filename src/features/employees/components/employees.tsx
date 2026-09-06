"use client";

import { format } from "date-fns";
import { SearchIcon, UsersIcon } from "lucide-react";
import Link from "next/link";
import { memo, useState } from "react";

import {
  DataTable,
  TableEmpty,
  TableSkeleton,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/components/dashboard/data-table";
import { PageHeader } from "@/components/dashboard/page";
import {
  Panel,
  PanelActions,
  PanelHeader,
  PanelTitle,
} from "@/components/dashboard/panel";
import {
  EmptyView,
  EntityContainer,
  EntityPagination,
  ErrorView,
} from "@/components/entity-components";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EMPLOYEE_STATUSES } from "@/features/employees/lib/employee";
import { cn } from "@/lib/utils";

import {
  useEmployeeStatusCounts,
  useEmployees,
  useSuspenseEmployees,
} from "../hooks/use-employees";
import { useEmployeesParams } from "../hooks/use-employees-params";
import {
  EMPLOYEE_STATUS_META,
  EmployeeStatusPill,
  employeeStatusMeta,
} from "../lib/status";
import { EmployeeCreateDialog } from "./employee-form";

const COLUMNS = 5;

/** Options are derived from the contract, so a new status appears here for free. */
const STATUS_OPTIONS = [
  { value: "ALL", label: "All statuses" },
  ...EMPLOYEE_STATUSES.map((status) => ({
    value: status,
    label: EMPLOYEE_STATUS_META[status].label,
  })),
];

const formatDate = (value: Date | string | null): string | null =>
  value === null ? null : format(new Date(value), "d MMM yyyy");

const EmployeesTableHead = () => (
  <THead>
    <tr>
      <TH>Employee</TH>
      <TH className="hidden md:table-cell">Role</TH>
      <TH className="hidden lg:table-cell">Department</TH>
      <TH>Status</TH>
      <TH align="right" className="hidden sm:table-cell">
        Start date
      </TH>
    </tr>
  </THead>
);

export const EmployeesList = () => {
  const employees = useSuspenseEmployees();
  const items = employees.data.items;
  const [params] = useEmployeesParams();

  const hasActiveFilters = (params.status ?? "") !== "";

  return (
    <DataTable>
      <EmployeesTableHead />
      <TBody>
        {items.length === 0 ? (
          <TableEmpty colSpan={COLUMNS}>
            {hasActiveFilters ? <EmployeesNoResults /> : <EmployeesEmpty />}
          </TableEmpty>
        ) : (
          items.map((employee) => (
            <EmployeeRow key={employee.id} data={employee} />
          ))
        )}
      </TBody>
    </DataTable>
  );
};

const EmployeesStatusFilter = () => {
  const [params, setParams] = useEmployeesParams();

  return (
    <Select
      value={params.status || "ALL"}
      onValueChange={(value) =>
        setParams({
          ...params,
          status: value === "ALL" ? null : value,
          page: 1,
        })
      }
    >
      <SelectTrigger
        aria-label="Filter by status"
        className="h-8 w-[160px] border-hairline bg-panel text-xs shadow-none"
      >
        <SelectValue placeholder="All statuses" />
      </SelectTrigger>
      <SelectContent>
        {STATUS_OPTIONS.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            className="text-xs"
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

/**
 * Count-by-status strip (AF-M11-09).
 *
 * Every phase is shown, including the empty ones — a chain with a gap in it is
 * the thing a people team needs to see. Each chip filters the list to that
 * phase, so the summary is also the navigation.
 */
const EmployeeStatusSummary = () => {
  const counts = useEmployeeStatusCounts();
  const [params, setParams] = useEmployeesParams();

  if (!counts.data) return null;

  // Statuses this build does not know still appear, as themselves.
  const chips = [...counts.data.byStatus, ...counts.data.other];

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map(({ status, count }) => {
        const active = params.status === status;
        return (
          <button
            key={status}
            type="button"
            aria-pressed={active}
            onClick={() =>
              setParams({
                ...params,
                status: active ? null : status,
                page: 1,
              })
            }
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs transition-colors",
              active
                ? "border-primary/30 bg-primary/10 text-primary"
                : "border-hairline bg-well text-muted-foreground hover:text-foreground",
            )}
          >
            {employeeStatusMeta(status).label}
            <span className="font-mono tabular-nums">{count}</span>
          </button>
        );
      })}
    </div>
  );
};

const EmployeesNewButton = () => {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Add employee
      </Button>
      <EmployeeCreateDialog open={open} onOpenChange={setOpen} />
    </>
  );
};

export const EmployeesHeader = () => (
  <PageHeader
    title="Employees"
    description="Every person the lifecycle workflows have created or touched, in this workspace."
    actions={
      <>
        <EmployeesStatusFilter />
        <EmployeesNewButton />
      </>
    }
  />
);

export const EmployeesPagination = () => {
  const employees = useEmployees();
  const [params, setParams] = useEmployeesParams();

  if (!employees.data) return null;

  return (
    <EntityPagination
      disabled={employees.isFetching}
      totalPages={employees.data.totalPages}
      page={employees.data.page}
      onPageChange={(page) => setParams({ ...params, page })}
    />
  );
};

export const EmployeesContainer = ({
  children,
}: {
  children: React.ReactNode;
}) => (
  <EntityContainer header={<EmployeesHeader />}>
    <Panel>
      <PanelHeader>
        <PanelTitle hint="Newest first. Status is moved by the lifecycle workflows, never edited by hand.">
          People
        </PanelTitle>
        <PanelActions>
          <EmployeeStatusSummary />
        </PanelActions>
      </PanelHeader>
      {children}
      <EmployeesPagination />
    </Panel>
  </EntityContainer>
);

export const EmployeesLoading = () => (
  <DataTable>
    <EmployeesTableHead />
    <TBody>
      <TableSkeleton columns={COLUMNS} />
    </TBody>
  </DataTable>
);

export const EmployeesError = () => (
  <ErrorView message="Error loading employees" />
);

/** Filters are active but matched nothing — distinct from the onboarding empty. */
export const EmployeesNoResults = () => {
  const [params, setParams] = useEmployeesParams();

  return (
    <EmptyView
      icon={SearchIcon}
      title="No matching people"
      message="No one in this workspace has that status right now. Try a different status or clear the filter."
      onNew={() => setParams({ ...params, status: null, page: 1 })}
      actionLabel="Clear filter"
    />
  );
};

export const EmployeesEmpty = () => {
  const [open, setOpen] = useState(false);

  return (
    <>
      <EmptyView
        icon={UsersIcon}
        title="No people yet"
        message="People appear here as soon as a hiring workflow records an offer — or add one by hand to start the chain from a candidate."
        onNew={() => setOpen(true)}
        actionLabel="Add employee"
      />
      <EmployeeCreateDialog open={open} onOpenChange={setOpen} />
    </>
  );
};

export const EmployeeRow = memo(
  ({
    data,
  }: {
    data: {
      id: string;
      employeeRef: string;
      fullName: string;
      email: string;
      role: string;
      department: string | null;
      status: string;
      startDate: Date | string | null;
    };
  }) => (
    <TR href={`/employees/${data.id}`}>
      <TD className="max-w-[260px]">
        <Link
          href={`/employees/${data.id}`}
          className="block truncate font-medium hover:text-primary hover:underline"
        >
          {data.fullName}
        </Link>
        <span className="block truncate font-mono text-xs text-muted-foreground">
          {data.employeeRef}
        </span>
      </TD>
      <TD className="hidden max-w-[200px] truncate md:table-cell">
        {data.role}
      </TD>
      <TD className="hidden text-muted-foreground lg:table-cell">
        {data.department ?? "-"}
      </TD>
      <TD>
        <EmployeeStatusPill status={data.status} />
      </TD>
      <TD
        align="right"
        className="hidden text-muted-foreground tabular-nums sm:table-cell"
      >
        {formatDate(data.startDate) ?? "-"}
      </TD>
    </TR>
  ),
);
EmployeeRow.displayName = "EmployeeRow";
