"use client";

import { CheckCircle, Loader2, Search, Sparkles } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import { useTestKnowledgeQuery } from "../hooks/use-knowledge-sources";

interface TestRetrievalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TestRetrievalDialog({
  open,
  onOpenChange,
}: TestRetrievalDialogProps) {
  const [query, setQuery] = useState("");
  const [topK, setTopK] = useState(4);
  const [minSimilarity, setMinSimilarity] = useState(0.5);

  const testQueryMutation = useTestKnowledgeQuery();

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    await testQueryMutation.mutateAsync({
      query,
      topK,
      minSimilarity,
    });
  };

  const results = testQueryMutation.data?.results ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-6">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold flex items-center gap-2">
            <Search className="size-5 text-primary" />
            Test Knowledge Retrieval
          </DialogTitle>
          <DialogDescription className="text-sm">
            Execute a vector similarity search across your embedded sources to
            inspect matches and relevance scores.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSearch} className="space-y-4 pt-1">
          <div className="flex gap-2">
            <Input
              placeholder="Ask a question or enter semantic search terms..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="flex-1"
            />
            <Button
              type="submit"
              disabled={testQueryMutation.isPending || !query.trim()}
            >
              {testQueryMutation.isPending ? (
                <Loader2 className="size-4 animate-spin mr-2" />
              ) : (
                <Sparkles className="size-4 mr-2 text-primary" />
              )}
              Search
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-4 text-xs">
            <div className="space-y-1.5 bg-muted/40 p-2.5 rounded border">
              <div className="flex justify-between font-medium">
                <Label className="text-xs">Top K Results</Label>
                <span>{topK}</span>
              </div>
              <Slider
                value={[topK]}
                min={1}
                max={10}
                step={1}
                onValueChange={(val) => setTopK(val[0])}
              />
            </div>

            <div className="space-y-1.5 bg-muted/40 p-2.5 rounded border">
              <div className="flex justify-between font-medium">
                <Label className="text-xs">Min Similarity</Label>
                <span>{(minSimilarity * 100).toFixed(0)}%</span>
              </div>
              <Slider
                value={[minSimilarity]}
                min={0.1}
                max={0.9}
                step={0.05}
                onValueChange={(val) => setMinSimilarity(val[0])}
              />
            </div>
          </div>
        </form>

        <div className="flex-1 overflow-hidden mt-2">
          <Label className="text-xs font-semibold block mb-2">
            Retrieved Matches ({results.length})
          </Label>
          <ScrollArea className="h-[280px] pr-3">
            {testQueryMutation.isPending ? (
              <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground text-xs">
                <Loader2 className="size-5 animate-spin text-primary" />
                <span>Computing vector cosine distances…</span>
              </div>
            ) : results.length > 0 ? (
              <div className="space-y-3">
                {results.map((result) => (
                  <div
                    key={result.id}
                    className="p-3 bg-muted/30 rounded-lg border text-xs space-y-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-semibold text-foreground flex items-center gap-1.5">
                        <CheckCircle className="size-3.5 text-success" />
                        {result.sourceName} (Chunk #{result.chunkIndex + 1})
                      </div>
                      <Badge
                        variant="secondary"
                        className="font-mono text-[11px]"
                      >
                        Score: {(result.similarity * 100).toFixed(1)}%
                      </Badge>
                    </div>
                    <p className="text-muted-foreground font-sans whitespace-pre-wrap leading-relaxed">
                      {result.content}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-xs text-muted-foreground">
                {testQueryMutation.isSuccess
                  ? "No matching chunks found above the similarity threshold."
                  : "Submit a query above to run vector search."}
              </div>
            )}
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
