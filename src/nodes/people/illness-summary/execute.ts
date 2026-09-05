import "server-only";

import { NonRetriableError } from "inngest";
import type { NodeRun } from "@/nodes/types";
import type { LlmData } from "../../ai/llm/definition";
import { execute as llmExecute } from "../../ai/llm/execute";

const DEFAULT_SYSTEM_PROMPT =
  "You are an employee-lifecycle analyst. Summarize the employee's illness and sick-leave notes into a concise, factual briefing: stated condition, reported symptoms, expected duration, and any accommodations or return-to-work notes. Do not invent details that are not present.";

type IllnessSummaryData = {
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

export const execute: NodeRun<IllnessSummaryData> = async ({
  data,
  context,
  resolve,
  step,
  credentials,
  ...forwarded
}) => {
  const where = "Illness Summary node";

  if (!data.variableName?.trim()) {
    throw new NonRetriableError(`${where}: Variable name is missing`);
  }

  if (!data.userPrompt?.trim()) {
    throw new NonRetriableError(`${where}: Illness notes are missing`);
  }
  const illnessNotes = resolve(data.userPrompt).trim();
  if (!illnessNotes) {
    throw new NonRetriableError(
      `${where}: the illness notes expression resolved to nothing.`,
    );
  }

  const llmData: LlmData = {
    variableName: data.variableName,
    model: data.model,
    fallbackModels: data.fallbackModels,
    userPrompt: `${illnessNotes}\n\n${DEFAULT_SYSTEM_PROMPT}`,
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
