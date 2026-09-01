"use client";

import {
  AlertCircle,
  CheckCircle2,
  FileText,
  Globe,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { StatusPill } from "@/components/dashboard/status-pill";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useKnowledgeSource,
  useReindexSource,
} from "../hooks/use-knowledge-sources";

interface SourceDetailDialogProps {
  sourceId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SourceDetailDialog({
  sourceId,
  open,
  onOpenChange,
}: SourceDetailDialogProps) {
  const { data: source, isLoading } = useKnowledgeSource(sourceId);
  const reindexMutation = useReindexSource();

  if (!open || !sourceId) return null;

  const handleReindex = async () => {
    await reindexMutation.mutateAsync({ id: sourceId });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col p-6">
        <DialogHeader>
          <div className="flex items-center justify-between pr-6">
            <DialogTitle className="text-lg font-semibold flex items-center gap-2">
              <FileText className="size-5 text-primary" />
              {source?.name || "Source Details"}
            </DialogTitle>
            {source && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleReindex}
                disabled={
                  reindexMutation.isPending || source.status === "PROCESSING"
                }
              >
                <RefreshCw className="size-3.5 mr-1.5" />
                Reindex
              </Button>
            )}
          </div>
          <DialogDescription className="text-xs">
            Inspect ingested document metadata, chunk distributions, and raw
            text preview.
          </DialogDescription>
        </DialogHeader>

        {isLoading || !source ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground text-sm">
            <Loader2 className="size-6 animate-spin text-primary" />
            <span>Loading source chunks...</span>
          </div>
        ) : (
          <div className="flex-1 flex flex-col overflow-hidden space-y-4 pt-2">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-muted/40 p-3 rounded-lg border text-xs">
              <div>
                <span className="text-muted-foreground block">Status</span>
                <div className="mt-1">
                  {source.status === "EMBEDDED" ? (
                    <StatusPill tone="success" icon={<CheckCircle2 />}>
                      Embedded
                    </StatusPill>
                  ) : source.status === "PROCESSING" ? (
                    <StatusPill
                      tone="info"
                      icon={<Loader2 className="animate-spin" />}
                    >
                      Processing
                    </StatusPill>
                  ) : source.status === "FAILED" ? (
                    <StatusPill tone="danger" icon={<AlertCircle />}>
                      Error
                    </StatusPill>
                  ) : (
                    <StatusPill tone="neutral">Pending</StatusPill>
                  )}
                </div>
              </div>

              <div>
                <span className="text-muted-foreground block">
                  Total Chunks
                </span>
                <span className="font-semibold text-sm mt-0.5 block">
                  {source.chunkCount}
                </span>
              </div>

              <div>
                <span className="text-muted-foreground block">
                  Estimated Tokens
                </span>
                <span className="font-semibold text-sm mt-0.5 block">
                  ~{source.tokenCount.toLocaleString()}
                </span>
              </div>

              <div>
                <span className="text-muted-foreground block">Revision</span>
                <span className="font-semibold text-sm mt-0.5 block">
                  v{source.revision}
                </span>
              </div>
            </div>

            {source.errorMessage && (
              <div className="p-3 bg-destructive/10 text-destructive rounded-md text-xs border border-destructive/20 flex items-start gap-2">
                <AlertCircle className="size-4 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold block">Ingestion Failed</span>
                  <p className="mt-0.5">{source.errorMessage}</p>
                </div>
              </div>
            )}

            <Tabs
              defaultValue="chunks"
              className="flex-1 flex flex-col overflow-hidden"
            >
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="chunks">
                  Chunks ({source.chunks?.length ?? 0})
                </TabsTrigger>
                <TabsTrigger value="info">Source Info</TabsTrigger>
              </TabsList>

              <TabsContent
                value="chunks"
                className="flex-1 overflow-hidden pt-2"
              >
                <ScrollArea className="h-[320px] pr-3">
                  {source.chunks && source.chunks.length > 0 ? (
                    <div className="space-y-3">
                      {source.chunks.map((chunk) => (
                        <div
                          key={chunk.id}
                          className="p-3 bg-muted/30 rounded-lg border text-xs space-y-1.5"
                        >
                          <div className="flex items-center justify-between text-muted-foreground">
                            <span className="font-semibold text-foreground">
                              Chunk #{chunk.chunkIndex + 1}
                            </span>
                            <span>~{chunk.tokens} tokens</span>
                          </div>
                          <p className="text-foreground font-mono text-[11px] whitespace-pre-wrap leading-relaxed">
                            {chunk.content}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-12 text-xs text-muted-foreground">
                      No chunks available for this source yet.
                    </div>
                  )}
                </ScrollArea>
              </TabsContent>

              <TabsContent value="info" className="space-y-3 pt-3 text-xs">
                <div className="space-y-1">
                  <span className="text-muted-foreground block">
                    Source Type
                  </span>
                  <p className="font-medium">{source.type}</p>
                </div>
                {source.url && (
                  <div className="space-y-1">
                    <span className="text-muted-foreground block">URL</span>
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:underline flex items-center gap-1"
                    >
                      <Globe className="size-3.5" />
                      {source.url}
                    </a>
                  </div>
                )}
                <div className="space-y-1">
                  <span className="text-muted-foreground block">MIME Type</span>
                  <p className="font-mono">{source.mimeType || "unknown"}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-muted-foreground block">
                    Created At
                  </span>
                  <p>{new Date(source.createdAt).toLocaleString()}</p>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
