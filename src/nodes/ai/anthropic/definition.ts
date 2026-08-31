import type { NodeDefinition } from "@/nodes/types";
import { aiModelDataSchema } from "../../shared/config-fields";

export const configSchema = aiModelDataSchema();

export const definition: NodeDefinition = {
  type: "ANTHROPIC",
  version: 1,
  category: "AI",
  label: "Anthropic",
  description:
    "Generate text with an Anthropic Claude model. Prompts support templates against upstream results.",
  icon: "BrainCircuit",
  keywords: ["anthropic", "claude", "llm", "text", "ai"],
  configSchema,
  defaults: {},
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  credentials: [
    { key: "credentialId", type: "anthropic.apiKey", required: true },
  ],
  deprecated: {
    since: "2026-08-31",
    replacedBy: "AI_LLM",
    reason:
      "Superseded by AI Chat, which reaches every registered provider, supports fallback chains, JSON mode, and per-run cost capture. This node is pinned to claude-sonnet-4-5 and records no usage.",
  },
};
