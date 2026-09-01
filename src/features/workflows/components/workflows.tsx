"use client";

import { formatDistanceToNow } from "date-fns";
import { MoreVerticalIcon, TrashIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { memo } from "react";

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
import {
  Panel,
  PanelActions,
  PanelHeader,
  PanelTitle,
} from "@/components/dashboard/panel";
import {
  StatusPill,
  type StatusTone,
} from "@/components/dashboard/status-pill";
import {
  EmptyView,
  EntityContainer,
  EntityHeader,
  EntityPagination,
  EntitySearch,
  ErrorView,
} from "@/components/entity-components";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useEntitySearch } from "@/hooks/use-entity-search";
import { useUpgradeModal } from "@/hooks/use-upgrade-modal";

import {
  useCreateWorkflow,
  useRemoveWorkflow,
  useSuspenseWorkflows,
  useWorkflows,
} from "../hooks/use-workflows";
import { useWorkflowsParams } from "../hooks/use-workflows-params";

const COLUMNS = 5;

type WorkflowRowData = {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  revision: number;
  activeVersion?: { version: number; workflowRevision: number } | null;
};

/**
 * Publish state as one pill, so a list of workflows answers "what is actually
 * live?" without opening each one.
 */
const publishState = (
  data: WorkflowRowData,
): { label: string; tone: StatusTone } => {
  if (!data.activeVersion) return { label: "Draft", tone: "neutral" };
  if (data.activeVersion.workflowRevision === data.revision) {
    return { label: `Active v${data.activeVersion.version}`, tone: "success" };
  }
  return {
    label: `Unpublished changes (v${data.activeVersion.version})`,
    tone: "warning",
  };
};

export const WorkflowsSearch = () => {
  const [params, setParams] = useWorkflowsParams();
  const { searchValue, onSearchChange } = useEntitySearch({
    params,
    setParams,
  });

  return (
    <EntitySearch
      value={searchValue}
      onChange={onSearchChange}
      placeholder="Search workflows"
    />
  );
};

const WorkflowsTableHead = () => (
  <THead>
    <tr>
      <TH>Workflow</TH>
      <TH>State</TH>
      <TH align="right" className="hidden lg:table-cell">
        Revision
      </TH>
      <TH className="hidden md:table-cell">Updated</TH>
      <TH align="right">
        <span className="sr-only">Actions</span>
      </TH>
    </tr>
  </THead>
);

export const WorkflowsList = () => {
  const workflows = useSuspenseWorkflows();
  const items = workflows.data.items;

  return (
    <DataTable>
      <WorkflowsTableHead />
      <TBody>
        {items.length === 0 ? (
          <TableEmpty colSpan={COLUMNS}>
            <WorkflowsEmpty />
          </TableEmpty>
        ) : (
          items.map((workflow) => (
            <WorkflowRow key={workflow.id} data={workflow} />
          ))
        )}
      </TBody>
    </DataTable>
  );
};

export const WorkflowsHeader = ({ disabled }: { disabled?: boolean }) => {
  const router = useRouter();
  const createWorkflow = useCreateWorkflow();
  const { handleError, modal } = useUpgradeModal();

  const handleCreate = () => {
    createWorkflow.mutate(undefined, {
      onSuccess: (data) => router.push(`/workflows/${data.id}`),
      onError: (error) => handleError(error),
    });
  };

  return (
    <>
      {modal}
      <EntityHeader
        title="Workflows"
        description="Create and manage your workflows"
        onNew={handleCreate}
        newButtonLabel="New workflow"
        disabled={disabled}
        isCreating={createWorkflow.isPending}
      />
    </>
  );
};

export const WorkflowsPagination = () => {
  const workflows = useWorkflows();
  const [params, setParams] = useWorkflowsParams();

  if (!workflows.data) return null;

  return (
    <EntityPagination
      disabled={workflows.isFetching}
      totalPages={workflows.data.totalPages}
      page={workflows.data.page}
      onPageChange={(page) => setParams({ ...params, page })}
    />
  );
};

export const WorkflowsContainer = ({
  children,
}: {
  children: React.ReactNode;
}) => (
  <EntityContainer header={<WorkflowsHeader />}>
    <Panel>
      <PanelHeader>
        <PanelTitle hint="Every workflow in this workspace, most recently updated first.">
          All workflows
        </PanelTitle>
        <PanelActions>
          <WorkflowsSearch />
        </PanelActions>
      </PanelHeader>
      {children}
      <WorkflowsPagination />
    </Panel>
  </EntityContainer>
);

export const WorkflowsLoading = () => (
  <DataTable>
    <WorkflowsTableHead />
    <TBody>
      <TableSkeleton columns={COLUMNS} />
    </TBody>
  </DataTable>
);

export const WorkflowsError = () => (
  <ErrorView message="Error loading workflows" />
);

export const WorkflowsEmpty = () => {
  const router = useRouter();
  const createWorkflow = useCreateWorkflow();
  const { handleError, modal } = useUpgradeModal();

  return (
    <>
      {modal}
      <EmptyView
        title="No workflows yet"
        message="A workflow is a trigger plus the nodes that run after it. Start from a template to see a working one, or build on an empty canvas."
        actionLabel="Create workflow"
        onNew={() =>
          createWorkflow.mutate(undefined, {
            onError: (error) => handleError(error),
            onSuccess: (data) => router.push(`/workflows/${data.id}`),
          })
        }
        secondaryAction={{
          label: "Start from a template",
          onClick: () => router.push("/templates"),
        }}
      />
    </>
  );
};

export const WorkflowRow = memo(({ data }: { data: WorkflowRowData }) => {
  const removeWorkflow = useRemoveWorkflow();
  const state = publishState(data);

  return (
    <TR
      href={`/workflows/${data.id}`}
      className={removeWorkflow.isPending ? "opacity-50" : undefined}
    >
      <TD className="max-w-[320px]">
        <Link
          href={`/workflows/${data.id}`}
          prefetch
          className="block truncate font-medium hover:text-primary hover:underline"
        >
          {data.name}
        </Link>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Created {formatDistanceToNow(data.createdAt, { addSuffix: true })}
        </p>
      </TD>
      <TD>
        <StatusPill tone={state.tone}>{state.label}</StatusPill>
      </TD>
      <TD
        align="right"
        className="hidden font-mono text-muted-foreground tabular-nums lg:table-cell"
      >
        r{data.revision}
      </TD>
      <TD className="hidden text-muted-foreground md:table-cell">
        {formatDistanceToNow(data.updatedAt, { addSuffix: true })}
      </TD>
      <TD align="right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`Actions for ${data.name}`}
              className="text-muted-foreground hover:text-foreground"
            >
              <MoreVerticalIcon className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              className="gap-2 text-destructive focus:text-destructive"
              disabled={removeWorkflow.isPending}
              onClick={() => removeWorkflow.mutate({ id: data.id })}
            >
              <TrashIcon className="size-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TD>
    </TR>
  );
});
WorkflowRow.displayName = "WorkflowRow";
