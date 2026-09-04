import type { EditorNode } from "@/features/editor/store/atoms";
import type { AiModelDef, AiProviderId } from "@/lib/ai/registry";
import {
  aiModelId,
  aiProviderById,
  estimateAttachmentTokens,
  estimateRunCostUsd,
  findAiModel,
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
 * Non-throwing: unknown providers/models fall through to the raw string (the estimator
 * then prices it at $0) rather than surfacing a registry resolution error on the canvas.
 */
function resolveNodeModel(
  type: string,
  data: Record<string, unknown>,
): string | undefined {
  if (typeof data.model === "string" && data.model.trim()) {
    const raw = data.model.trim();
    const colonIdx = raw.indexOf(":");
    if (colonIdx !== -1) {
      const provider = raw.slice(0, colonIdx) as AiProviderId;
      const modelHint = raw.slice(colonIdx + 1);
      const def = resolveRegistered(provider, modelHint);
      if (def) {
        return aiModelId(def.provider, def.model);
      }
      return raw;
    }
    // Bare provider name
    const providerDef = aiProviderById.get(raw as AiProviderId);
    if (providerDef) {
      const def = findAiModel(
        aiModelId(providerDef.id, providerDef.defaultModel),
      );
      if (def) {
        return aiModelId(def.provider, def.model);
      }
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

/** Exact model lookup, else the provider's registered default; undefined if either is unknown. */
function resolveRegistered(
  provider: AiProviderId,
  modelHint: string,
): AiModelDef | undefined {
  const exact = findAiModel(aiModelId(provider, modelHint));
  if (exact !== undefined) {
    return exact;
  }
  const providerDef = aiProviderById.get(provider);
  if (providerDef === undefined) {
    return undefined;
  }
  return findAiModel(aiModelId(provider, providerDef.defaultModel));
}

/**
 * Computes estimated tokens and cost for a single node on the canvas.
 * Returns `null` if the node is not an AI node or has no computable cost.
 */
/**
 * Bytes an `attachments` expression will carry, read from the `size` fields of
 * any file references literally present in it.
 *
 * On the canvas the expression is usually a template (`{{{json doc.file}}}`)
 * whose size is unknowable until the run — those estimate as one typical
 * scanned page rather than as zero, because zero is a specific and wrong
 * claim, while "about a page" is honestly approximate.
 */
const TYPICAL_ATTACHMENT_BYTES = 500 * 1024;

export function estimateAttachmentBytes(attachments: unknown): number {
  if (typeof attachments !== "string" || attachments.trim().length === 0) {
    return 0;
  }
  // A literal reference pasted into the field carries its own size.
  const sizes = [...attachments.matchAll(/"size"\s*:\s*(\d+)/g)].map((m) =>
    Number.parseInt(m[1], 10),
  );
  if (sizes.length > 0) {
    return sizes.reduce((total, size) => total + size, 0);
  }
  return TYPICAL_ATTACHMENT_BYTES;
}

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

  // AF-M10-07: an attachment is input the model pays for. Estimating it as
  // zero would tell a user that adding a 4 MB scan to every invoice costs
  // nothing, which is the opposite of true — vision input is usually the
  // larger half of such a call.
  //
  // Bytes are the only signal available before the call (providers price
  // images by tile count, which needs the decoded dimensions), so this is an
  // approximation and the estimator says so. The RECORDED cost still comes
  // from the provider's own usage numbers.
  const attachmentTokens = estimateAttachmentTokens(
    estimateAttachmentBytes(data.attachments),
  );

  const inputTokens = Math.max(
    1,
    estimateTokens(promptText) + attachmentTokens,
  );
  const outputTokens =
    typeof data.maxTokens === "number" && data.maxTokens > 0
      ? Math.round(data.maxTokens)
      : defaultOutputTokens;

  // Price only registered models; unknown provider:model pairs estimate at $0
  // rather than surfacing a registry resolution error on the canvas.
  let costUsd = 0;
  const modelDef = findAiModel(modelId);
  if (modelDef !== undefined) {
    costUsd = estimateRunCostUsd(modelId, { inputTokens, outputTokens });
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
