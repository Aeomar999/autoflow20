import "server-only";
import { generateObject, generateText, jsonSchema } from "ai";
import { NonRetriableError } from "inngest";
import { compileTemplate } from "@/features/executions/template";
import { executeWithFallback, parseModelChain } from "@/lib/ai/fallback";
import type { NodeRun } from "@/nodes/types";
import type { LlmData } from "./definition";

const DEFAULT_SYSTEM_PROMPT =
  "You are a helpful automation assistant operating inside an AutoFlow workflow.";

export const execute: NodeRun<LlmData> = async ({
  data,
  context,
  step,
  credentials,
}) => {
  if (!data.variableName) {
    throw new NonRetriableError("AI Chat node: Variable name is missing");
  }
  if (!data.userPrompt) {
    throw new NonRetriableError("AI Chat node: Prompt is missing");
  }
  if (data.jsonMode && !data.jsonSchema) {
    throw new NonRetriableError(
      "AI Chat node: JSON mode requires a response JSON schema on the node",
    );
  }

  const resolvedSystem = data.systemPrompt
    ? compileTemplate(data.systemPrompt)(context).trim()
    : DEFAULT_SYSTEM_PROMPT;
  const resolvedPrompt = compileTemplate(data.userPrompt)(context).trim();

  let parsedSchema: Parameters<typeof jsonSchema>[0] | undefined;
  if (data.jsonMode) {
    try {
      parsedSchema = JSON.parse(data.jsonSchema as string);
    } catch {
      throw new NonRetriableError(
        "AI Chat node: configured response JSON schema is not valid JSON",
      );
    }
  }

  const callSettings = {
    temperature: data.temperature ?? 0.7,
    ...(data.maxTokens !== undefined
      ? { maxOutputTokens: data.maxTokens }
      : {}),
    experimental_telemetry: {
      isEnabled: true,
      recordInputs: true,
      recordOutputs: true,
    },
  };

  const candidates = parseModelChain(data.model, data.fallbackModels);

  const { result: text, servedModel } = await executeWithFallback(
    candidates,
    credentials,
    "AI Chat node",
    async (candidate) => {
      if (data.jsonMode && parsedSchema) {
        const result = await step.ai.wrap(
          `llm-generate-object:${candidate.fullModelId}`,
          generateObject,
          {
            model: candidate.languageModel,
            system: resolvedSystem,
            prompt: resolvedPrompt,
            schema: jsonSchema(parsedSchema),
            ...callSettings,
          },
        );
        const object = (result as { object?: unknown }).object ?? null;
        return JSON.stringify(object, null, 2);
      }

      const result = await step.ai.wrap(
        `llm-generate-text:${candidate.fullModelId}`,
        generateText,
        {
          model: candidate.languageModel,
          system: resolvedSystem,
          prompt: resolvedPrompt,
          ...callSettings,
        },
      );
      const content = (
        result as {
          steps?: Array<{
            content?: Array<{ type?: string; text?: string }>;
          }>;
        }
      ).steps?.[0]?.content?.[0];
      const resText =
        content && content.type === "text" ? (content.text ?? "") : "";
      if (!resText) {
        throw new NonRetriableError(
          "AI Chat node: model returned an empty response",
        );
      }
      return resText;
    },
  );

  return {
    ...context,
    [data.variableName as string]: {
      text,
      model: servedModel,
    },
  };
};
