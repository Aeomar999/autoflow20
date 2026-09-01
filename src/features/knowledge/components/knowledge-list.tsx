"use client";

import { formatDistanceToNow } from "date-fns";
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  FileCodeIcon,
  FileTextIcon,
  GlobeIcon,
  Loader2Icon,
  MoreVerticalIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  Trash2Icon,
} from "lucide-react";
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
import {
  DashboardError,
  DashboardPage,
  PageHeader,
  PageHeaderSkeleton,
} from "@/components/dashboard/page";
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
  EntityPagination,
  EntitySearch,
} from "@/components/entity-components";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useEntitySearch } from "@/hooks/use-entity-search";

import { useKnowledgeParams } from "../hooks/use-knowledge-params";
import {
  useKnowledgeSources,
  useReindexSource,
  useSuspenseKnowledgeSources,
} from "../hooks/use-knowledge-sources";
import { DeleteSourceDialog } from "./delete-source-dialog";
import { SourceDetailDialog } from "./source-detail-dialog";
import { TestRetrievalDialog } from "./test-retrieval-dialog";
import { UploadSourceDialog } from "./upload-source-dialog";

const COLUMNS = 6;

interface KnowledgeItemData {
  id: string;
  name: string;
  type: string;
  mimeType: string | null;
  sizeBytes: number | null;
  url: string | null;
  status: string;
  errorMessage: string | null;
  revision: number;
  chunkCount: number;
  tokenCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const sourceIcon = (type: string, mimeType?: string | null) => {
  if (type === "URL") return <GlobeIcon className="size-4 text-info" />;
  if (mimeType?.includes("markdown") || mimeType?.includes("text")) {
    return <FileCodeIcon className="size-4 text-success" />;
  }
  return <FileTextIcon className="size-4 text-primary" />;
};

const STATUS_META: Record<
  string,
  { label: string; tone: StatusTone; icon: React.ReactNode }
> = {
  EMBEDDED: {
    label: "Embedded",
    tone: "success",
    icon: <CheckCircle2Icon />,
  },
  PROCESSING: {
    label: "Processing",
    tone: "info",
    icon: <Loader2Icon className="animate-spin" />,
  },
  ERROR: { label: "Error", tone: "danger", icon: <AlertCircleIcon /> },
};

const KnowledgeStatusPill = ({
  status,
  errorMessage,
}: {
  status: string;
  errorMessage?: string | null;
}) => {
  const meta = STATUS_META[status];

  if (!meta) {
    return <StatusPill tone="neutral">Pending</StatusPill>;
  }

  return (
    <StatusPill
      tone={meta.tone}
      icon={meta.icon}
      title={status === "ERROR" ? (errorMessage ?? undefined) : undefined}
    >
      {meta.label}
    </StatusPill>
  );
};

export const KnowledgeSearch = () => {
  const [params, setParams] = useKnowledgeParams();
  const { searchValue, onSearchChange } = useEntitySearch({
    params,
    setParams,
  });

  return (
    <EntitySearch
      value={searchValue}
      onChange={onSearchChange}
      placeholder="Search sources"
    />
  );
};

export const KnowledgePagination = () => {
  const sources = useKnowledgeSources();
  const [params, setParams] = useKnowledgeParams();

  if (!sources.data) return null;

  return (
    <EntityPagination
      disabled={sources.isFetching}
      totalPages={sources.data.totalPages}
      page={sources.data.page}
      onPageChange={(page) => setParams({ ...params, page })}
    />
  );
};

const KnowledgeTableHead = () => (
  <THead>
    <tr>
      <TH>Source</TH>
      <TH>Status</TH>
      <TH align="right" className="hidden sm:table-cell">
        Chunks
      </TH>
      <TH align="right" className="hidden lg:table-cell">
        Tokens
      </TH>
      <TH className="hidden md:table-cell">Updated</TH>
      <TH align="right">
        <span className="sr-only">Actions</span>
      </TH>
    </tr>
  </THead>
);

export const KnowledgeLoading = () => (
  <DashboardPage>
    <PageHeaderSkeleton />
    <Panel>
      <DataTable>
        <KnowledgeTableHead />
        <TBody>
          <TableSkeleton columns={COLUMNS} />
        </TBody>
      </DataTable>
    </Panel>
  </DashboardPage>
);

export const KnowledgeError = () => (
  <DashboardPage>
    <DashboardError message="Error loading knowledge sources" />
  </DashboardPage>
);

export const KnowledgeEmpty = ({ onNew }: { onNew: () => void }) => (
  <EmptyView
    actionLabel="Add source"
    onNew={onNew}
    message="No sources yet. Ingest a PDF, DOCX, webpage or text document and it becomes retrievable by your AI nodes."
  />
);

const KnowledgeRow = memo(
  ({
    data,
    onInspect,
  }: {
    data: KnowledgeItemData;
    onInspect: (id: string) => void;
  }) => {
    const [deleteOpen, setDeleteOpen] = useState(false);
    const reindex = useReindexSource();

    return (
      <>
        <TR>
          <TD className="max-w-[300px]">
            <div className="flex items-center gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-hairline bg-well">
                {sourceIcon(data.type, data.mimeType)}
              </span>
              <div className="min-w-0">
                <button
                  type="button"
                  onClick={() => onInspect(data.id)}
                  className="block max-w-full truncate text-left font-medium hover:text-primary hover:underline"
                >
                  {data.name}
                </button>
                <p className="truncate text-xs text-muted-foreground">
                  {data.type}
                </p>
              </div>
            </div>
          </TD>
          <TD>
            <KnowledgeStatusPill
              status={data.status}
              errorMessage={data.errorMessage}
            />
          </TD>
          <TD
            align="right"
            className="hidden font-mono text-muted-foreground tabular-nums sm:table-cell"
          >
            {data.chunkCount.toLocaleString()}
          </TD>
          <TD
            align="right"
            className="hidden font-mono text-muted-foreground tabular-nums lg:table-cell"
          >
            {data.tokenCount.toLocaleString()}
          </TD>
          <TD className="hidden text-muted-foreground md:table-cell">
            {formatDistanceToNow(new Date(data.updatedAt), {
              addSuffix: true,
            })}
          </TD>
          <TD align="right">
            <div className="flex items-center justify-end gap-1">
              <Button
                size="sm"
                variant="outline"
                className="hidden h-7 border-hairline bg-panel px-2 text-xs sm:inline-flex"
                onClick={() => onInspect(data.id)}
              >
                Chunks
              </Button>
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
                    className="gap-2"
                    onClick={() => onInspect(data.id)}
                  >
                    <FileTextIcon className="size-4" />
                    View details and chunks
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="gap-2"
                    disabled={reindex.isPending}
                    onClick={() => reindex.mutate({ id: data.id })}
                  >
                    <RefreshCwIcon className="size-4" />
                    Reindex
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="gap-2 text-destructive focus:text-destructive"
                    onClick={() => setDeleteOpen(true)}
                  >
                    <Trash2Icon className="size-4" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </TD>
        </TR>

        <DeleteSourceDialog
          sourceId={data.id}
          sourceName={data.name}
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
        />
      </>
    );
  },
);
KnowledgeRow.displayName = "KnowledgeRow";

export const KnowledgeList = () => {
  const sources = useSuspenseKnowledgeSources();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);

  const items = sources.data.items;

  return (
    <DashboardPage>
      <PageHeader
        title="Knowledge Base"
        description="Ingest documents, webpages, and data into pgvector for AI retrieval."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              className="border-hairline bg-panel"
              onClick={() => setTestOpen(true)}
            >
              <SearchIcon className="size-4" />
              Test retrieval
            </Button>
            <Button size="sm" onClick={() => setUploadOpen(true)}>
              <PlusIcon className="size-4" />
              Add source
            </Button>
          </>
        }
      />

      <Panel>
        <PanelHeader>
          <PanelTitle hint="Each source is chunked and embedded; AI nodes retrieve the chunks, not the file.">
            Indexed sources
          </PanelTitle>
          <PanelActions>
            <KnowledgeSearch />
          </PanelActions>
        </PanelHeader>

        <DataTable>
          <KnowledgeTableHead />
          <TBody>
            {items.length === 0 ? (
              <TableEmpty colSpan={COLUMNS}>
                <KnowledgeEmpty onNew={() => setUploadOpen(true)} />
              </TableEmpty>
            ) : (
              items.map((source) => (
                <KnowledgeRow
                  key={source.id}
                  data={source}
                  onInspect={setSelectedSourceId}
                />
              ))
            )}
          </TBody>
        </DataTable>

        <KnowledgePagination />
      </Panel>

      <UploadSourceDialog open={uploadOpen} onOpenChange={setUploadOpen} />
      <TestRetrievalDialog open={testOpen} onOpenChange={setTestOpen} />
      <SourceDetailDialog
        sourceId={selectedSourceId}
        open={Boolean(selectedSourceId)}
        onOpenChange={(open) => !open && setSelectedSourceId(null)}
      />
    </DashboardPage>
  );
};
