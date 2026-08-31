import "server-only";
import { generateObject, jsonSchema } from "ai";
import { NonRetriableError } from "inngest";
import { compileTemplate } from "@/features/executions/template";
import { WORKFLOW_USAGE_KEY } from "@/inngest/trace";
import { buildAiCacheKey, normalizeCacheTtlSeconds } from "@/lib/ai/cache";
import { executeWithFallback, parseModelChain } from "@/lib/ai/fallback";
import type { NodeRun } from "@/nodes/types";
import { definition, type ExtractData } from "./definition";

const SYSTEM_PROMPT =
  "You are a precise data extraction assistant inside an AutoFlow workflow. Extract only the requested fields from the provided text and return exactly the JSON shape requested. Never invent values that are not present in the text.";

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
  organizationId,
  step,
  credentials,
}) => {
  if (!data.variableName) {
    throw new NonRetriableError("AI Extract node: Variable name is missing");
  }
  if (!data.content) {
    throw new NonRetriableError("AI Extract node: Source content is missing");
  }

  const resolvedContent = compileTemplate(data.content)(context).trim();
  if (!resolvedContent) {
    throw new NonRetriableError(
      "AI Extract node: source content resolved to an empty value",
    );
  }

  const outputSchema = buildOutputSchema(data);
  const candidates = parseModelChain(data.model, data.fallbackModels);

  // AF-M5-07: the output schema is part of the fingerprint — extracting a new
  // field must re-ask the model rather than replay the narrower answer.
  const cacheTtlSeconds = normalizeCacheTtlSeconds(data.cacheTtlSeconds);
  const cacheKey = buildAiCacheKey({
    nodeType: definition.type,
    candidates,
    system: SYSTEM_PROMPT,
    prompt: resolvedContent,
    params: { outputSchema },
  });

  const { result: object, usage } = await executeWithFallback(
    candidates,
    credentials,
    "AI Extract node",
    async (candidate) => {
      const result = await step.ai.wrap(
        `llm-extract:${candidate.fullModelId}`,
        generateObject,
        {
          model: candidate.languageModel,
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

      const resObj = (result as { object?: unknown }).object;
      if (resObj === undefined || resObj === null) {
        throw new NonRetriableError(
          "AI Extract node: model returned no structured output",
        );
      }
      const resUsage = (result as { usage?: Record<string, number> }).usage;
      return {
        value: resObj,
        usage: resUsage,
      };
    },
    {
      organizationId,
      nodeType: definition.type,
      cacheKey,
      ttlSeconds: cacheTtlSeconds,
    },
  );

  return {
    ...context,
    [data.variableName as string]: object,
    [WORKFLOW_USAGE_KEY]: usage,
  };
};
