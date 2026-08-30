import "server-only";
import { generateObject, generateText, jsonSchema } from "ai";
import { NonRetriableError } from "inngest";
import { compileTemplate } from "@/features/executions/template";
import { createLanguageModel } from "@/lib/ai/provider";
import {
  AI_PROVIDERS,
  type AiModelDef,
  type AiProviderId,
  aiModelId,
  aiProviderById,
  resolveAiModel,
} from "@/lib/ai/registry";
import type { NodeRun } from "@/nodes/types";
import type { LlmData } from "./definition";

const DEFAULT_SYSTEM_PROMPT =
  "You are a helpful automation assistant operating inside an AutoFlow workflow.";

/** Splits "provider:model" into its legs; a bare token is just a provider. */
function splitModelId(raw: string | undefined): {
  provider: string;
  modelHint: string | undefined;
} {
  if (!raw || raw.length === 0) {
    return { provider: "", modelHint: undefined };
  }
  const colon = raw.indexOf(":");
  if (colon === -1) {
    return { provider: raw.trim(), modelHint: undefined };
  }
  return {
    provider: raw.slice(0, colon).trim(),
    modelHint: raw.slice(colon + 1).trim() || undefined,
  };
}

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

  const { provider, modelHint } = splitModelId(data.model);
  const providerDef = aiProviderById.get(provider as AiProviderId);
  if (providerDef === undefined) {
    throw new NonRetriableError(
      `AI Chat node: unknown provider "${provider || "<unset>"}". Configure a model like "openai:gpt-4o". Providers: ${AI_PROVIDERS.join(", ")}`,
    );
  }

  // Exact `provider:model` wins, else the provider default (docs/architecture/overview.md §5.4).
  let model: AiModelDef;
  try {
    model = resolveAiModel(providerDef.id, modelHint);
  } catch (error) {
    throw new NonRetriableError(
      `AI Chat node: ${error instanceof Error ? error.message : "unknown model"}`,
    );
  }
  const fullModelId = aiModelId(model.provider, model.model);

  const secret =
    model.adapter === "anthropic"
      ? credentials?.anthropicCredentialId
      : model.adapter === "google"
        ? credentials?.geminiCredentialId
        : credentials?.openaiCredentialId;
  const apiKey = secret?.apiKey ?? secret?.accessToken;

  if (providerDef.requiresKey && !apiKey) {
    throw new NonRetriableError(
      `AI Chat node: credential required for provider "${providerDef.id}" (${providerDef.credentialType ?? "api key"}), but none is configured on the node`,
    );
  }

  const resolvedSystem = data.systemPrompt
    ? compileTemplate(data.systemPrompt)(context).trim()
    : DEFAULT_SYSTEM_PROMPT;
  const resolvedPrompt = compileTemplate(data.userPrompt)(context).trim();

  const modelRef = createLanguageModel({
    adapter: model.adapter,
    modelId: model.model,
    apiKey,
    baseUrl: providerDef.baseUrl,
  });

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

  let text: string;
  if (data.jsonMode) {
    let schema: Parameters<typeof jsonSchema>[0];
    try {
      schema = JSON.parse(data.jsonSchema as string);
    } catch {
      throw new NonRetriableError(
        "AI Chat node: configured response JSON schema is not valid JSON",
      );
    }
    const result = await step.ai.wrap(
      `llm-generate-object:${fullModelId}`,
      generateObject,
      {
        model: modelRef,
        system: resolvedSystem,
        prompt: resolvedPrompt,
        schema: jsonSchema(schema),
        ...callSettings,
      },
    );
    const object = (result as { object?: unknown }).object ?? null;
    text = JSON.stringify(object, null, 2);
  } else {
    const result = await step.ai.wrap(
      `llm-generate-text:${fullModelId}`,
      generateText,
      {
        model: modelRef,
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
    text = content && content.type === "text" ? (content.text ?? "") : "";
    if (!text) {
      throw new NonRetriableError(
        "AI Chat node: model returned an empty response",
      );
    }
  }

  return {
    ...context,
    [data.variableName as string]: {
      text,
      model: fullModelId,
    },
  };
};
