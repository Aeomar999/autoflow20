"use client";

import {
  CheckIcon,
  Code2Icon,
  CopyIcon,
  FileCodeIcon,
  TerminalIcon,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export const CodeShowcase = () => {
  const [activeTab, setActiveTab] = useState<
    "definition" | "execute" | "event"
  >("definition");
  const [hasCopied, setHasCopied] = useState<boolean>(false);

  const codeSnippets = {
    definition: `// src/nodes/ai/anthropic/definition.ts
import { z } from "zod";
import type { NodeDefinition } from "@/nodes/types";

export const configSchema = z.object({
  model: z.enum(["claude-3-5-sonnet-20241022", "claude-3-haiku-20240307"]),
  prompt: z.string().min(1, "Prompt template is required"),
  temperature: z.number().min(0).max(1).default(0.7),
  credentialId: z.string().min(1, "Anthropic API Key required"),
});

export const definition: NodeDefinition<z.infer<typeof configSchema>> = {
  type: "ai.anthropic",
  version: 1,
  category: "AI",
  label: "Anthropic Claude",
  description: "Execute reasoning tasks with Claude 3.5 Sonnet",
  icon: "Sparkles",
  configSchema,
  defaults: {
    model: "claude-3-5-sonnet-20241022",
    prompt: "Summarize the customer ticket: {{trigger.output.body}}",
    temperature: 0.7,
    credentialId: "",
  },
  inputs: [{ id: "input", label: "Context" }],
  outputs: [{ id: "output", label: "Analysis" }],
  credentials: [{ key: "credentialId", type: "anthropic.api-key", required: true }],
};`,

    execute: `// src/nodes/ai/anthropic/execute.ts
import "server-only";
import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import type { NodeRunParams } from "@/nodes/types";

export async function execute({
  data,
  step,
  credentials,
  publish,
  nodeId,
}: NodeRunParams): Promise<Record<string, unknown>> {
  // Credentials injected at runtime from AES-256-GCM vault
  const apiKey = credentials?.credentialId?.value;
  if (!apiKey) throw new Error("Missing decrypted Anthropic API key");

  // Run as durable Inngest step with automatic retry & channel stream
  const result = await step.run("claude-inference", async () => {
    await publish({ channel: "node-status", topic: nodeId, data: { status: "RUNNING" } });

    const { text, usage } = await generateText({
      model: anthropic(data.model, { apiKey }),
      prompt: data.prompt,
      temperature: data.temperature,
    });

    return { response: text, tokens: usage.totalTokens };
  });

  return result;
}`,

    event: `// Inngest Engine Execution Event (Redacted & Sealed)
{
  "name": "workflow/execution.dispatched",
  "data": {
    "workflowId": "wf_01j789xla01",
    "executionId": "exec_90812x4",
    "userId": "user_prod_9921",
    "nodes": [
      { "id": "trigger_1", "type": "payments.stripe-trigger", "status": "SUCCESS" },
      { "id": "ai_2", "type": "ai.anthropic", "status": "SUCCESS", "latencyMs": 840 }
    ],
    "context": {
      "trigger_1": { "amount": 24900, "currency": "usd" },
      "ai_2": { "riskScore": 0.92, "category": "HIGH_PRIORITY_FRAUD" }
    }
  },
  "user": { "org": "enterprise_01" }
}`,
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(codeSnippets[activeTab]);
    setHasCopied(true);
    setTimeout(() => setHasCopied(false), 2000);
  };

  return (
    <section
      id="sdk"
      className="border-t border-border/50 bg-muted/20 py-20 sm:py-28"
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center">
          <Badge
            variant="outline"
            className="border-primary/30 bg-primary/5 text-primary text-xs"
          >
            TypeScript First
          </Badge>
          <h2 className="mt-3 font-bold text-3xl tracking-tight text-foreground sm:text-4xl">
            Clean developer ergonomics, zero magic
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-base text-muted-foreground">
            AutoFlow enforces an isomorphic boundary: client-safe Zod
            definitions drive the UI canvas, while strictly isolated server
            executors run inside durable Inngest step workers.
          </p>
        </div>

        {/* Code Editor Mock */}
        <div className="mt-12 overflow-hidden rounded-2xl border border-border/80 bg-zinc-950 shadow-2xl">
          {/* Editor Header / Tab Bar */}
          <div className="flex flex-wrap items-center justify-between border-b border-zinc-800 bg-zinc-900/90 px-4 py-2.5">
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 pr-3">
                <span className="size-3 rounded-full bg-red-500/80" />
                <span className="size-3 rounded-full bg-amber-500/80" />
                <span className="size-3 rounded-full bg-emerald-500/80" />
              </div>

              {/* Tabs */}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setActiveTab("definition")}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-mono transition-colors",
                    activeTab === "definition"
                      ? "bg-zinc-800 text-zinc-100"
                      : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200",
                  )}
                >
                  <FileCodeIcon className="size-3.5 text-zinc-400" />
                  <span>definition.ts (Zod)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("execute")}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-mono transition-colors",
                    activeTab === "execute"
                      ? "bg-zinc-800 text-zinc-100"
                      : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200",
                  )}
                >
                  <Code2Icon className="size-3.5 text-zinc-400" />
                  <span>execute.ts (Server-only)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("event")}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-mono transition-colors",
                    activeTab === "event"
                      ? "bg-zinc-800 text-zinc-100"
                      : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200",
                  )}
                >
                  <TerminalIcon className="size-3.5 text-zinc-400" />
                  <span>runtime-event.json</span>
                </button>
              </div>
            </div>

            {/* Copy Button */}
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1 rounded-md bg-zinc-800 px-2.5 py-1 text-xs font-mono text-zinc-300 hover:bg-zinc-700 hover:text-white transition-colors"
            >
              {hasCopied ? (
                <>
                  <CheckIcon className="size-3 text-emerald-400" />
                  <span>Copied!</span>
                </>
              ) : (
                <>
                  <CopyIcon className="size-3" />
                  <span>Copy Code</span>
                </>
              )}
            </button>
          </div>

          {/* Code Content */}
          <div className="overflow-x-auto p-4 sm:p-6 font-mono text-xs leading-relaxed text-zinc-200 scrollbar-thin">
            <pre className="selection:bg-primary/30">
              <code>{codeSnippets[activeTab]}</code>
            </pre>
          </div>
        </div>
      </div>
    </section>
  );
};
