"use client";

import { useAtomValue } from "jotai";
import { CoinsIcon, SparklesIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { formatUsdCost } from "@/features/editor/lib/cost-estimate";
import { workflowCostEstimateAtom } from "@/features/editor/store/atoms";

export function CostEstimateBadge() {
  const estimate = useAtomValue(workflowCostEstimateAtom);

  if (estimate.aiNodeCount === 0) {
    return null;
  }

  const totalTokens = estimate.totalInputTokens + estimate.totalOutputTokens;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 rounded-full border-border/80 bg-background/95 px-3 text-xs font-medium shadow-sm backdrop-blur transition-all hover:bg-muted/80 hover:shadow"
          aria-label="Workflow cost estimate"
        >
          <SparklesIcon className="size-3.5 text-warning animate-pulse" />
          <span>Est. ~{estimate.formattedCost}</span>
          <span className="text-[10px] text-muted-foreground">/ run</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="center" side="top" className="w-80 p-3 shadow-xl">
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between border-b border-border/60 pb-2">
            <div className="flex items-center gap-1.5">
              <CoinsIcon className="size-4 text-warning" />
              <span className="text-xs font-semibold text-foreground">
                Estimated AI Run Cost
              </span>
            </div>
            <Badge variant="secondary" className="font-mono text-[11px]">
              {estimate.formattedCost}
            </Badge>
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Estimated Tokens</span>
            <span className="font-medium text-foreground">
              ~{totalTokens.toLocaleString()} tokens
            </span>
          </div>

          <div className="flex flex-col gap-1.5 pt-1">
            <span className="text-[11px] font-medium text-muted-foreground">
              Node Breakdown ({estimate.aiNodeCount}{" "}
              {estimate.aiNodeCount === 1 ? "node" : "nodes"})
            </span>
            <div className="max-h-48 overflow-y-auto space-y-1.5 rounded-md border border-border/40 bg-muted/30 p-2">
              {estimate.nodeEstimates.map((item) => (
                <div
                  key={item.nodeId}
                  className="flex flex-col gap-0.5 border-b border-border/30 pb-1.5 last:border-0 last:pb-0"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span
                      className="font-medium truncate max-w-[170px]"
                      title={item.nodeName}
                    >
                      {item.nodeName}
                    </span>
                    <span className="font-mono text-[11px] text-foreground font-semibold">
                      {formatUsdCost(item.costUsd)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground font-mono">
                    <span className="truncate max-w-[140px]">
                      {item.modelId}
                    </span>
                    <span>
                      {item.inputTokens} in / {item.outputTokens} out
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <p className="text-[10px] text-muted-foreground border-t border-border/40 pt-1.5 italic">
            Pre-run estimate based on prompt character length and model pricing
            tables.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
