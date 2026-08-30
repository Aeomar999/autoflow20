import type { EditorNode } from "@/features/editor/store/atoms";
import {
  aiModelId,
  aiProviderById,
  defaultAiModelId,
  estimateRunCostUsd,
  resolveAiModel,
} from "@/lib/ai/registry";

export interface NodeCostEstimate {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface WorkflowCostEstimate {
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  aiNodeCount: number;
  nodeEstimates: NodeCostEstimate[];
  formattedCost: string;
}

/**
 * Estimates token count from raw text using a standard ~4 chars/token heuristic.
 * Empty or whitespace-only text returns 0. Non-empty text returns at least 1 token.
 */
export function estimateTokens(text?: string | null): number {
  if (!text || typeof text !== "string") {
    return 0;
  }
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return 0;
  }
  return Math.max(1, Math.ceil(trimmed.length / 4));
}

/**
 * Formats a USD cost into a human-readable string.
 * Uses micro-dollar precision for tiny values (< $0.01) and 2 decimals for larger values.
 */
export function formatUsdCost(costUsd: number): string {
  if (costUsd === 0) {
    return "$0.00";
  }
  if (costUsd < 0.0001) {
    return "< $0.0001";
  }
  if (costUsd < 0.01) {
    return `$${costUsd.toFixed(4)}`;
  }
  return `$${costUsd.toFixed(3)}`;
}

/** Default output token allocations for estimation when maxTokens is unspecified. */
const DEFAULT_CHAT_OUTPUT_TOKENS = 500;
const DEFAULT_EXTRACT_OUTPUT_TOKENS = 256;

/**
 * Resolves a model ID string from node configuration or defaults for known AI node types.
 */
function resolveNodeModel(
  type: string,
  data: Record<string, unknown>,
): string | undefined {
  if (typeof data.model === "string" && data.model.trim()) {
    const raw = data.model.trim();
    const colonIdx = raw.indexOf(":");
    if (colonIdx !== -1) {
      const provider = raw.slice(0, colonIdx);
      const modelHint = raw.slice(colonIdx + 1);
      try {
        const def = resolveAiModel(
          provider as Parameters<typeof resolveAiModel>[0],
          modelHint,
        );
        return aiModelId(def.provider, def.model);
      } catch {
        return raw;
      }
    }
    // Bare provider or model name
    try {
      const providerDef = aiProviderById.get(
        raw as Parameters<typeof defaultAiModelId>[0],
      );
      if (providerDef) {
        return defaultAiModelId(providerDef.id);
      }
    } catch {
      // Fall through
    }
    return raw;
  }

  // Fallbacks by node type
  if (type === "OPENAI") return "openai:gpt-4o";
  if (type === "ANTHROPIC") return "anthropic:claude-3-5-sonnet";
  if (type === "GEMINI") return "google:gemini-1.5-pro";
  if (type === "ai.llm") return "openai:gpt-4o";
  if (type === "ai.extract") return "openai:gpt-4o";

  return undefined;
}

/**
 * Computes estimated tokens and cost for a single node on the canvas.
 * Returns `null` if the node is not an AI node or has no computable cost.
 */
export function estimateNodeCost(node: EditorNode): NodeCostEstimate | null {
  const type = node.type;
  if (!type) return null;

  const data = (node.data ?? {}) as Record<string, unknown>;

  // Check if node is an AI node
  const isAiNode =
    type === "ai.llm" ||
    type === "ai.extract" ||
    type === "OPENAI" ||
    type === "ANTHROPIC" ||
    type === "GEMINI" ||
    type === "OPENAI_COMPATIBLE_CHAT" ||
    type.startsWith("ai.");

  if (!isAiNode || type === "ai.retrieve") {
    return null;
  }

  const modelId = resolveNodeModel(type, data);
  if (!modelId) return null;

  // Extract prompt text
  let promptText = "";
  let defaultOutputTokens = DEFAULT_CHAT_OUTPUT_TOKENS;

  if (type === "ai.extract") {
    defaultOutputTokens = DEFAULT_EXTRACT_OUTPUT_TOKENS;
    const content = typeof data.content === "string" ? data.content : "";
    const jsonSchemaStr =
      typeof data.jsonSchema === "string"
        ? data.jsonSchema
        : Array.isArray(data.fields)
          ? JSON.stringify(data.fields)
          : "";
    promptText = `${content} ${jsonSchemaStr}`;
  } else {
    const sys = typeof data.systemPrompt === "string" ? data.systemPrompt : "";
    const user = typeof data.userPrompt === "string" ? data.userPrompt : "";
    promptText = `${sys} ${user}`;
  }

  const inputTokens = Math.max(1, estimateTokens(promptText));
  const outputTokens =
    typeof data.maxTokens === "number" && data.maxTokens > 0
      ? Math.round(data.maxTokens)
      : defaultOutputTokens;

  let costUsd = 0;
  try {
    costUsd = estimateRunCostUsd(modelId, { inputTokens, outputTokens });
  } catch {
    costUsd = 0;
  }

  return {
    nodeId: node.id,
    nodeName: node.name || type,
    nodeType: type,
    modelId,
    inputTokens,
    outputTokens,
    costUsd,
  };
}

/**
 * Calculates aggregate cost and token estimates across all active AI nodes in the canvas graph.
 */
export function estimateWorkflowCost(
  nodes: EditorNode[],
): WorkflowCostEstimate {
  let totalCostUsd = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const nodeEstimates: NodeCostEstimate[] = [];

  for (const node of nodes) {
    if (node.disabled) {
      continue;
    }
    const estimate = estimateNodeCost(node);
    if (estimate) {
      nodeEstimates.push(estimate);
      totalCostUsd += estimate.costUsd;
      totalInputTokens += estimate.inputTokens;
      totalOutputTokens += estimate.outputTokens;
    }
  }

  const roundedTotalCost = Math.round(totalCostUsd * 1e6) / 1e6;

  return {
    totalCostUsd: roundedTotalCost,
    totalInputTokens,
    totalOutputTokens,
    aiNodeCount: nodeEstimates.length,
    nodeEstimates,
    formattedCost: formatUsdCost(roundedTotalCost),
  };
}
