"use client";

import {
  ArrowRightIcon,
  CheckCircle2Icon,
  ClockIcon,
  CoinsIcon,
  CopyIcon,
  DatabaseIcon,
  EyeIcon,
  GitBranchIcon,
  GlobeIcon,
  Loader2Icon,
  MailIcon,
  MessageSquareIcon,
  PlayIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
  SparklesIcon,
  TerminalIcon,
  UsersIcon,
  WebhookIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MOCK_WORKFLOWS } from "../data/mock-workflows";
import type { ExecutionState, MockWorkflowTemplate, StepState } from "../types";

const getNodeIcon = (iconName: string) => {
  switch (iconName) {
    case "Webhook":
      return WebhookIcon;
    case "Sparkles":
      return SparklesIcon;
    case "GitBranch":
      return GitBranchIcon;
    case "MessageSquare":
      return MessageSquareIcon;
    case "Database":
      return DatabaseIcon;
    case "Globe":
      return GlobeIcon;
    case "Users":
      return UsersIcon;
    case "Mail":
      return MailIcon;
    case "Clock":
      return ClockIcon;
    default:
      return TerminalIcon;
  }
};

export const InteractiveCanvasPreview = () => {
  const [selectedTemplateIndex, setSelectedTemplateIndex] = useState<number>(0);
  const activeTemplate: MockWorkflowTemplate =
    MOCK_WORKFLOWS[selectedTemplateIndex] || MOCK_WORKFLOWS[0];

  const [nodeStates, setNodeStates] = useState<Record<string, StepState>>({});
  const [executionState, setExecutionState] = useState<ExecutionState>("idle");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [copiedPayload, setCopiedPayload] = useState<boolean>(false);

  // Initialize node states when template changes
  useEffect(() => {
    const initialStates: Record<string, StepState> = {};
    for (const node of activeTemplate.nodes) {
      initialStates[node.id] = "pending";
    }
    setNodeStates(initialStates);
    setExecutionState("idle");
    setSelectedNodeId(activeTemplate.nodes[0]?.id ?? null);
  }, [activeTemplate]);

  const selectedNode =
    activeTemplate.nodes.find((n) => n.id === selectedNodeId) ||
    activeTemplate.nodes[0];

  // Simulation Runner
  const runSimulation = () => {
    if (executionState === "running") return;

    setExecutionState("running");
    const initialStates: Record<string, StepState> = {};
    for (const node of activeTemplate.nodes) {
      initialStates[node.id] = "pending";
    }
    setNodeStates(initialStates);

    const sequence = activeTemplate.executionSequence;
    let currentStep = 0;

    const executeNextStep = () => {
      if (currentStep >= sequence.length) {
        setExecutionState("success");
        return;
      }

      const nodeId = sequence[currentStep];
      setSelectedNodeId(nodeId);

      // Set to running
      setNodeStates((prev) => ({ ...prev, [nodeId]: "running" }));

      const nodeObj = activeTemplate.nodes.find((n) => n.id === nodeId);
      const stepDuration = Math.max(
        350,
        Math.min(nodeObj?.durationMs ?? 400, 750),
      );

      setTimeout(() => {
        setNodeStates((prev) => ({ ...prev, [nodeId]: "success" }));
        currentStep++;
        setTimeout(executeNextStep, 150);
      }, stepDuration);
    };

    executeNextStep();
  };

  const resetSimulation = () => {
    const initialStates: Record<string, StepState> = {};
    for (const node of activeTemplate.nodes) {
      initialStates[node.id] = "pending";
    }
    setNodeStates(initialStates);
    setExecutionState("idle");
  };

  const handleCopyPayload = (data: unknown) => {
    navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    setCopiedPayload(true);
    setTimeout(() => setCopiedPayload(false), 2000);
  };

  return (
    <div
      id="simulator"
      className="relative mx-auto w-full max-w-6xl rounded-2xl border border-border/80 bg-card p-2 shadow-2xl sm:p-4"
    >
      {/* Top Banner / Template Selector Bar */}
      <div className="flex flex-col gap-3 border-b border-border/50 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {MOCK_WORKFLOWS.map((wf, idx) => (
            <button
              key={wf.id}
              type="button"
              onClick={() => {
                setSelectedTemplateIndex(idx);
              }}
              className={cn(
                "flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
                selectedTemplateIndex === idx
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <span>{wf.name}</span>
              <span
                className={cn(
                  "rounded px-1.5 py-0.2 text-[10px]",
                  selectedTemplateIndex === idx
                    ? "bg-primary-foreground/20 text-primary-foreground"
                    : "bg-background/80 text-muted-foreground",
                )}
              >
                {wf.tag}
              </span>
            </button>
          ))}
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={runSimulation}
            disabled={executionState === "running"}
            className={cn(
              "h-8 gap-1.5 font-medium text-xs shadow-xs",
              executionState === "running" ? "animate-pulse" : "",
            )}
          >
            {executionState === "running" ? (
              <>
                <Loader2Icon className="size-3.5 animate-spin" />
                <span>Executing Graph...</span>
              </>
            ) : (
              <>
                <PlayIcon className="size-3.5 fill-current" />
                <span>Run Simulation</span>
              </>
            )}
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={resetSimulation}
            disabled={executionState === "running"}
            className="h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground"
            title="Reset Simulation"
          >
            <RotateCcwIcon className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Main Canvas & Inspector Area */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Visual Graph View (8 Cols on Desktop) */}
        <div className="relative flex flex-col justify-between overflow-hidden rounded-xl border border-border/60 bg-muted/20 p-4 sm:p-6 lg:col-span-8">
          {/* Subtle Grid Background */}
          <div
            className="absolute inset-0 opacity-[0.07] pointer-events-none"
            style={{
              backgroundImage:
                "radial-gradient(var(--foreground) 1px, transparent 1px)",
              backgroundSize: "20px 20px",
            }}
          />

          {/* Graph Header Status */}
          <div className="relative z-10 mb-6 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2">
              <span className="flex size-2 items-center justify-center">
                <span
                  className={cn(
                    "size-2 rounded-full",
                    executionState === "running"
                      ? "bg-amber-500 animate-ping"
                      : executionState === "success"
                        ? "bg-emerald-500"
                        : "bg-muted-foreground/50",
                  )}
                />
              </span>
              <span className="font-mono text-muted-foreground">
                Engine:{" "}
                <strong className="text-foreground">Inngest Durable DAG</strong>
              </span>
            </div>

            <div className="flex items-center gap-3 font-mono text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <ClockIcon className="size-3 text-primary" />
                <span>{activeTemplate.totalLatency}</span>
              </span>
              <span className="flex items-center gap-1">
                <CoinsIcon className="size-3 text-emerald-500" />
                <span>{activeTemplate.estimatedCost}</span>
              </span>
            </div>
          </div>

          {/* Graph Nodes Display */}
          <div className="relative z-10 flex flex-col gap-4 py-2 sm:gap-6">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-2">
              {activeTemplate.nodes.map((node) => {
                const IconComponent = getNodeIcon(node.iconName);
                const status = nodeStates[node.id] || "pending";
                const isSelected = selectedNode?.id === node.id;

                return (
                  <button
                    key={node.id}
                    type="button"
                    onClick={() => setSelectedNodeId(node.id)}
                    className={cn(
                      "group relative flex cursor-pointer flex-col gap-2 rounded-xl border p-3.5 text-left transition-all duration-200",
                      isSelected
                        ? "border-primary bg-card ring-2 ring-primary/20 shadow-md"
                        : "border-border/80 bg-card/80 hover:border-muted-foreground/50 hover:bg-card",
                      status === "running" &&
                        "border-amber-500/80 bg-amber-500/5 ring-2 ring-amber-500/20",
                      status === "success" &&
                        "border-emerald-500/40 bg-emerald-500/5",
                    )}
                  >
                    {/* Node Header */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div
                          className={cn(
                            "flex size-7 items-center justify-center rounded-lg border border-primary/20 bg-primary/5 text-primary text-xs font-semibold shadow-2xs",
                          )}
                        >
                          <IconComponent className="size-3.5" />
                        </div>
                        <div>
                          <h4 className="text-xs font-semibold tracking-tight text-foreground">
                            {node.label}
                          </h4>
                          <p className="font-mono text-[10px] text-muted-foreground">
                            {node.type}
                          </p>
                        </div>
                      </div>

                      {/* Status Indicator Badge */}
                      <div>
                        {status === "pending" && (
                          <span className="inline-flex size-2 rounded-full bg-muted-foreground/30" />
                        )}
                        {status === "running" && (
                          <Loader2Icon className="size-3.5 animate-spin text-amber-500" />
                        )}
                        {status === "success" && (
                          <CheckCircle2Icon className="size-3.5 text-emerald-500" />
                        )}
                      </div>
                    </div>

                    {/* Node Subtitle */}
                    <p className="line-clamp-1 text-[11px] text-muted-foreground">
                      {node.subtitle}
                    </p>

                    {/* Node Footer Meta */}
                    <div className="flex w-full items-center justify-between border-t border-border/40 pt-2 text-[10px] text-muted-foreground">
                      <span className="font-mono">
                        {status === "success"
                          ? `${node.durationMs}ms`
                          : "ready"}
                      </span>
                      <span className="flex items-center gap-1 text-primary group-hover:underline">
                        <EyeIcon className="size-2.5" />
                        <span>Inspect</span>
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Graph Helper Footer */}
          <div className="relative z-10 mt-4 flex items-center justify-between border-t border-border/40 pt-3 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-primary" />
              <span>
                Click any node to inspect real execution IO & cryptographic
                isolation
              </span>
            </span>
            <Link
              href="/signup"
              className="flex items-center gap-1 font-medium text-foreground hover:text-primary transition-colors"
            >
              <span>Build this in Studio</span>
              <ArrowRightIcon className="size-3" />
            </Link>
          </div>
        </div>

        {/* Real-time Node Inspector & Log Stream (4 Cols on Desktop) */}
        <div className="flex flex-col rounded-xl border border-border/80 bg-card p-4 shadow-sm lg:col-span-4">
          <div className="flex items-center justify-between border-b border-border/60 pb-3">
            <div className="flex items-center gap-2">
              <TerminalIcon className="size-4 text-primary" />
              <h3 className="font-semibold text-sm">Node Inspector</h3>
            </div>
            <Badge variant="outline" className="font-mono text-[10px]">
              {selectedNode?.type || "core.node"}
            </Badge>
          </div>

          {selectedNode ? (
            <div className="mt-3 flex flex-1 flex-col gap-3 text-xs">
              {/* Selected Node Summary */}
              <div className="rounded-lg bg-muted/40 p-2.5">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-foreground">
                    {selectedNode.label}
                  </span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {nodeStates[selectedNode.id] === "success"
                      ? `${selectedNode.durationMs}ms`
                      : nodeStates[selectedNode.id] === "running"
                        ? "running..."
                        : "pending"}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {selectedNode.subtitle}
                </p>
              </div>

              {/* Security & Vault Isolation Badge */}
              {selectedNode.credentialsRequired && (
                <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-2.5 py-1.5 text-[11px] text-emerald-600 dark:text-emerald-400">
                  <ShieldCheckIcon className="size-3.5 shrink-0" />
                  <span className="line-clamp-1 font-mono text-[10px]">
                    Vault: {selectedNode.credentialsRequired}
                  </span>
                </div>
              )}

              {/* Output Payload JSON Preview */}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-[11px] text-muted-foreground">
                    Node Output State (JSON)
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      handleCopyPayload(selectedNode.outputPayload)
                    }
                    className="flex items-center gap-1 font-mono text-[10px] text-primary hover:underline"
                  >
                    <CopyIcon className="size-2.5" />
                    <span>{copiedPayload ? "Copied!" : "Copy"}</span>
                  </button>
                </div>
                <pre className="max-h-40 overflow-x-auto rounded-lg border border-border/70 bg-muted/30 p-2.5 font-mono text-[10.5px] leading-relaxed text-foreground scrollbar-thin">
                  {JSON.stringify(selectedNode.outputPayload || {}, null, 2)}
                </pre>
              </div>

              {/* Real-time Execution Logs */}
              <div className="flex flex-col gap-1">
                <span className="font-medium text-[11px] text-muted-foreground">
                  Step Execution Traces
                </span>
                <div className="flex max-h-28 flex-col gap-1 overflow-y-auto rounded-lg border border-border/70 bg-zinc-950 p-2 font-mono text-[10px] text-zinc-300">
                  {selectedNode.logs?.map((log) => (
                    <div key={log} className="leading-tight">
                      {log}
                    </div>
                  )) || (
                    <div className="text-zinc-500">
                      Waiting for trigger dispatch...
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center p-6 text-center text-xs text-muted-foreground">
              Select a node on the canvas to inspect its output payload and
              trace.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
