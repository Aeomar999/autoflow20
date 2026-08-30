import "server-only";
import { generateObject, jsonSchema } from "ai";
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
import type { ExtractData } from "./definition";

const SYSTEM_PROMPT =
  "You are a precise data extraction assistant inside an AutoFlow workflow. Extract only the requested fields from the provided text and return exactly the JSON shape requested. Never invent values that are not present in the text.";

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

/**
 * Turns the schema-builder field list into a JSON object schema for the
 * model. Every declared field is required and unknown keys are rejected so
 * the model returns exactly the shape the user asked for.
 */
export function buildExtractionSchema(
  fields: NonNullable<ExtractData["fields"]>,
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  const seen = new Set<string>();
  for (const field of fields) {
    if (seen.has(field.name)) {
      throw new NonRetriableError(
        `AI Extract node: duplicate field name "${field.name}"`,
      );
    }
    seen.add(field.name);
    properties[field.name] = field.description
      ? { type: field.type, description: field.description }
      : { type: field.type };
    required.push(field.name);
  }
  return {
    type: "object",
    additionalProperties: false,
    properties,
    required,
  };
}

/**
 * Validates a pasted JSON schema before handing it to generateObject: it
 * must parse and be a top-level JSON object schema so the model returns an
 * object rather than a bare value.
 */
export function parseStructuredSchema(raw: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new NonRetriableError(
      "AI Extract node: extraction schema is not valid JSON",
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new NonRetriableError(
      "AI Extract node: extraction schema must be a JSON object",
    );
  }
  const schema = parsed as Record<string, unknown>;
  if (schema.type !== "object") {
    throw new NonRetriableError(
      'AI Extract node: extraction schema must have "type": "object" at the top level so the model returns a JSON object',
    );
  }
  return schema;
}

/**
 * Resolves the output schema the model must fill. A pasted JSON schema wins
 * over the field-list builder; both absent is a run-time config error (kept
 * out of the zod schema so `defaults: {}` stays valid in the registry).
 */
export function buildOutputSchema(data: ExtractData): Record<string, unknown> {
  const rawSchema = data.jsonSchema?.trim();
  if (rawSchema && rawSchema.length > 0) {
    return parseStructuredSchema(rawSchema);
  }
  if (data.fields && data.fields.length > 0) {
    return buildExtractionSchema(data.fields);
  }
  throw new NonRetriableError(
    "AI Extract node: configure either an extraction schema (JSON) or at least one extraction field",
  );
}

export const execute: NodeRun<ExtractData> = async ({
  data,
  context,
  step,
  credentials,
}) => {
  if (!data.variableName) {
    throw new NonRetriableError("AI Extract node: Variable name is missing");
  }
  if (!data.content) {
    throw new NonRetriableError("AI Extract node: Source content is missing");
  }

  const { provider, modelHint } = splitModelId(data.model);
  const providerDef = aiProviderById.get(provider as AiProviderId);
  if (providerDef === undefined) {
    throw new NonRetriableError(
      `AI Extract node: unknown provider "${provider || "<unset>"}". Configure a model like "openai:gpt-4o". Providers: ${AI_PROVIDERS.join(", ")}`,
    );
  }

  // Exact `provider:model` wins, else the provider default (docs/architecture/overview.md §5.4).
  let model: AiModelDef;
  try {
    model = resolveAiModel(providerDef.id, modelHint);
  } catch (error) {
    throw new NonRetriableError(
      `AI Extract node: ${error instanceof Error ? error.message : "unknown model"}`,
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
      `AI Extract node: credential required for provider "${providerDef.id}" (${providerDef.credentialType ?? "api key"}), but none is configured on the node`,
    );
  }

  const resolvedContent = compileTemplate(data.content)(context).trim();
  if (!resolvedContent) {
    throw new NonRetriableError(
      "AI Extract node: source content resolved to an empty value",
    );
  }

  const outputSchema = buildOutputSchema(data);

  const modelRef = createLanguageModel({
    adapter: model.adapter,
    modelId: model.model,
    apiKey,
    baseUrl: providerDef.baseUrl,
  });

  const result = await step.ai.wrap(
    `llm-extract:${fullModelId}`,
    generateObject,
    {
      model: modelRef,
      system: SYSTEM_PROMPT,
      prompt: `Extract the fields described by the schema from the text below, and return only those fields.\n\nTEXT:\n"""${resolvedContent}"""`,
      schema: jsonSchema(outputSchema),
      experimental_telemetry: {
        isEnabled: true,
        recordInputs: true,
        recordOutputs: true,
      },
    },
  );

  const object = (result as { object?: unknown }).object;
  if (object === undefined || object === null) {
    throw new NonRetriableError(
      "AI Extract node: model returned no structured output",
    );
  }

  return {
    ...context,
    [data.variableName as string]: object,
  };
};
