"use client";

import { formatDistanceToNow } from "date-fns";
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  FileCode,
  FileText,
  Globe,
  Loader2,
  MoreVertical,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { memo, useState } from "react";
import {
  EmptyView,
  EntityContainer,
  EntityItem,
  EntityList,
  EntityPagination,
  EntitySearch,
  ErrorView,
  LoadingView,
} from "@/components/entity-components";
import { Badge } from "@/components/ui/badge";
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
      placeholder="Search knowledge sources"
    />
  );
};

export const KnowledgeHeader = ({
  onNew,
  onTest,
}: {
  onNew: () => void;
  onTest: () => void;
}) => {
  return (
    <div className="flex flex-row items-center justify-between gap-x-4">
      <div className="flex flex-col">
        <h1 className="text-lg md:text-xl font-semibold">Knowledge Base</h1>
        <p className="text-xs md:text-sm text-muted-foreground">
          Ingest documents, webpages, and data into pgvector for AI retrieval.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onTest}>
          <Search className="size-4 mr-1.5" />
          Test Retrieval
        </Button>
        <Button size="sm" onClick={onNew}>
          <BookOpen className="size-4 mr-1.5" />
          Add Source
        </Button>
      </div>
    </div>
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

export const KnowledgeLoading = () => {
  return <LoadingView message="Loading knowledge sources..." />;
};

export const KnowledgeError = () => {
  return <ErrorView message="Error loading knowledge sources" />;
};

export const KnowledgeEmpty = ({ onNew }: { onNew: () => void }) => {
  return (
    <EmptyView
      onNew={onNew}
      message="You haven't added any knowledge sources yet. Ingest your first PDF, DOCX, webpage, or text document to get started."
    />
  );
};

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

const getSourceIcon = (type: string, mimeType?: string | null) => {
  if (type === "URL") {
    return <Globe className="size-5 text-blue-500" />;
  }
  if (mimeType?.includes("markdown") || mimeType?.includes("text")) {
    return <FileCode className="size-5 text-emerald-500" />;
  }
  return <FileText className="size-5 text-primary" />;
};

const getStatusBadge = (status: string, errorMessage?: string | null) => {
  switch (status) {
    case "EMBEDDED":
      return (
        <Badge className="bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/20 border-emerald-500/30 text-[11px] h-5">
          <CheckCircle2 className="size-3 mr-1" />
          Embedded
        </Badge>
      );
    case "PROCESSING":
      return (
        <Badge className="bg-blue-500/15 text-blue-600 hover:bg-blue-500/20 border-blue-500/30 text-[11px] h-5">
          <Loader2 className="size-3 mr-1 animate-spin" />
          Processing
        </Badge>
      );
    case "ERROR":
      return (
        <Badge
          variant="destructive"
          className="text-[11px] h-5 cursor-help"
          title={errorMessage || "Processing error"}
        >
          <AlertCircle className="size-3 mr-1" />
          Error
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="text-[11px] h-5">
          Pending
        </Badge>
      );
  }
};

export const KnowledgeItem = memo(
  ({
    data,
    onInspect,
  }: {
    data: KnowledgeItemData;
    onInspect: (id: string) => void;
  }) => {
    const [deleteOpen, setDeleteOpen] = useState(false);
    const reindexMutation = useReindexSource();

    const handleReindex = async (e: React.MouseEvent) => {
      e.stopPropagation();
      await reindexMutation.mutateAsync({ id: data.id });
    };

    const subtitle = (
      <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
        {getStatusBadge(data.status, data.errorMessage)}
        <span>·</span>
        <span>
          {data.chunkCount} chunks (~{data.tokenCount.toLocaleString()} tokens)
        </span>
        <span>·</span>
        <span>
          Updated{" "}
          {formatDistanceToNow(new Date(data.updatedAt), { addSuffix: true })}
        </span>
      </div>
    );

    return (
      <>
        <EntityItem
          href="#"
          title={data.name}
          subtitle={subtitle}
          image={
            <div className="size-8 flex items-center justify-center bg-muted rounded-md">
              {getSourceIcon(data.type, data.mimeType)}
            </div>
          }
          actions={
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={() => onInspect(data.id)}
              >
                <FileText className="size-3.5 mr-1" />
                Chunks
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon" variant="ghost" className="size-8">
                    <MoreVertical className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => onInspect(data.id)}>
                    <FileText className="size-4 mr-2" />
                    View Details & Chunks
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleReindex}>
                    <RefreshCw className="size-4 mr-2" />
                    Reindex
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setDeleteOpen(true)}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="size-4 mr-2" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          }
        />

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
KnowledgeItem.displayName = "KnowledgeItem";

export const KnowledgeList = () => {
  const sources = useSuspenseKnowledgeSources();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);

  return (
    <EntityContainer
      header={
        <KnowledgeHeader
          onNew={() => setUploadOpen(true)}
          onTest={() => setTestOpen(true)}
        />
      }
      search={<KnowledgeSearch />}
      pagination={<KnowledgePagination />}
    >
      <EntityList
        items={sources.data.items}
        getKey={(source) => source.id}
        renderItem={(source) => (
          <KnowledgeItem
            data={source}
            onInspect={(id) => setSelectedSourceId(id)}
          />
        )}
        emptyView={<KnowledgeEmpty onNew={() => setUploadOpen(true)} />}
      />

      <UploadSourceDialog open={uploadOpen} onOpenChange={setUploadOpen} />

      <TestRetrievalDialog open={testOpen} onOpenChange={setTestOpen} />

      <SourceDetailDialog
        sourceId={selectedSourceId}
        open={Boolean(selectedSourceId)}
        onOpenChange={(open) => !open && setSelectedSourceId(null)}
      />
    </EntityContainer>
  );
};
