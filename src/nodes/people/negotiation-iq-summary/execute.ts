import "server-only";

import { NonRetriableError } from "inngest";
import type { NodeRun } from "@/nodes/types";
import type { LlmData } from "../../ai/llm/definition";
import { execute as llmExecute } from "../../ai/llm/execute";

const DEFAULT_SYSTEM_PROMPT =
  "You are a negotiation analyst. From the candidate's notes, summarize their compensation expectations, willingness to flex on non-compensation priorities, leverage points, and any deal-breakers. Be factual and concise; do not invent details that are not present.";

type NegotiationIqSummaryData = {
  variableName?: string;
  model?: string;
  fallbackModels?: string;
  openaiCredentialId?: string;
  anthropicCredentialId?: string;
  geminiCredentialId?: string;
  userPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  cacheTtlSeconds?: number;
};

export const execute: NodeRun<NegotiationIqSummaryData> = async ({
  data,
  context,
  resolve,
  step,
  credentials,
  ...forwarded
}) => {
  const where = "Negotiation IQ Summary node";

  if (!data.variableName?.trim()) {
    throw new NonRetriableError(`${where}: Variable name is missing`);
  }

  if (!data.userPrompt?.trim()) {
    throw new NonRetriableError(`${where}: Negotiation notes are missing`);
  }
  const negotiationNotes = resolve(data.userPrompt).trim();
  if (!negotiationNotes) {
    throw new NonRetriableError(
      `${where}: the negotiation notes expression resolved to nothing.`,
    );
  }

  const llmData: LlmData = {
    variableName: data.variableName,
    model: data.model,
    fallbackModels: data.fallbackModels,
    userPrompt: `${negotiationNotes}\n\n${DEFAULT_SYSTEM_PROMPT}`,
    temperature: data.temperature ?? 0.7,
    maxTokens: data.maxTokens,
    cacheTtlSeconds: data.cacheTtlSeconds,
    jsonMode: false,
  };

  return llmExecute({
    ...forwarded,
    data: llmData,
    context,
    resolve,
    step,
    credentials,
  });
};
