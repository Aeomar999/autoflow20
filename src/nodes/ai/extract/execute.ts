import "server-only";
import { generateObject, jsonSchema } from "ai";
import { NonRetriableError } from "inngest";
import { WORKFLOW_USAGE_KEY } from "@/inngest/trace";
import { buildAiCacheKey, normalizeCacheTtlSeconds } from "@/lib/ai/cache";
import {
  executeWithFallback,
  parseModelChain,
  pickRunUsage,
} from "@/lib/ai/fallback";
import {
  assertVisionCapable,
  EMPTY_ATTACHMENTS,
  resolveAttachments,
} from "@/nodes/shared/ai-attachments";
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
  resolve,
  organizationId,
  step,
  credentials,
}) => {
  if (!data.variableName) {
    throw new NonRetriableError("AI Extract node: Variable name is missing");
  }
  // AF-M10-07: with an attachment, the document IS the input — #21 extracts
  // from a faxed PDF and #8 from an invoice image, and requiring a text
  // `content` as well would mean inventing one.
  const renderedAttachments = data.attachments
    ? resolve(data.attachments).trim()
    : "";
  const hasAttachments = renderedAttachments.length > 0;

  if (!data.content && !hasAttachments) {
    throw new NonRetriableError(
      "AI Extract node: Source content is missing. Give it text to extract from, or attach a document.",
    );
  }

  const resolvedContent = data.content ? resolve(data.content).trim() : "";
  if (!resolvedContent && !hasAttachments) {
    throw new NonRetriableError(
      "AI Extract node: source content resolved to an empty value",
    );
  }

  const outputSchema = buildOutputSchema(data);
  const candidates = parseModelChain(data.model, data.fallbackModels);

  if (hasAttachments) {
    if (!organizationId) {
      throw new NonRetriableError(
        "AI Extract node: this run has no organization, so its attachments cannot be read.",
      );
    }
    assertVisionCapable(candidates, "AI Extract node");
  }

  // Content hashes for the cache key, read once from the primary. Two
  // different invoices must not share a cache entry (AF-M5-07 + AF-M10-07).
  const cacheAttachments = hasAttachments
    ? await resolveAttachments({
        rendered: renderedAttachments,
        organizationId: organizationId as string,
        adapter: "openai",
        where: "AI Extract node",
      })
    : EMPTY_ATTACHMENTS;

  // AF-M5-07: the output schema is part of the fingerprint — extracting a new
  // field must re-ask the model rather than replay the narrower answer.
  const cacheTtlSeconds = normalizeCacheTtlSeconds(data.cacheTtlSeconds);
  const cacheKey = buildAiCacheKey({
    nodeType: definition.type,
    candidates,
    system: SYSTEM_PROMPT,
    prompt: resolvedContent,
    params: {
      outputSchema,
      attachmentSha256s: cacheAttachments.sha256s,
    },
  });

  const { result: object, usage } = await executeWithFallback(
    candidates,
    credentials,
    "AI Extract node",
    async (candidate) => {
      // Per candidate: PDF handling differs by provider, so the payload is
      // built for the model that will actually receive it.
      const attachments = hasAttachments
        ? await resolveAttachments({
            rendered: renderedAttachments,
            organizationId: organizationId as string,
            adapter: candidate.modelDef.adapter,
            where: "AI Extract node",
          })
        : EMPTY_ATTACHMENTS;

      const textBody = [
        resolvedContent
          ? `TEXT:\n"""${resolvedContent}"""`
          : "The source is the attached document.",
        attachments.extractedText,
      ]
        .filter((part) => part.length > 0)
        .join("\n\n");

      const instruction = `Extract the fields described by the schema from the source below, and return only those fields.\n\n${textBody}`;

      const promptArgs =
        attachments.parts.length > 0
          ? {
              messages: [
                {
                  role: "user" as const,
                  content: [
                    { type: "text" as const, text: instruction },
                    ...attachments.parts,
                  ],
                },
              ],
            }
          : { prompt: instruction };

      const result = await step.ai.wrap(
        `llm-extract:${candidate.fullModelId}`,
        generateObject,
        {
          model: candidate.languageModel,
          system: SYSTEM_PROMPT,
          ...promptArgs,
          schema: jsonSchema(outputSchema),
          experimental_telemetry: {
            isEnabled: true,
            recordInputs: true,
            recordOutputs: true,
          },
        } as Parameters<typeof generateObject>[0],
      );

      const resObj = (result as { object?: unknown }).object;
      if (resObj === undefined || resObj === null) {
        throw new NonRetriableError(
          "AI Extract node: model returned no structured output",
        );
      }
      const resUsage = pickRunUsage(result);
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
    // AF-M10-07: which path each attachment took, so a PDF that read badly
    // has a visible cause rather than a guess.
    ...(hasAttachments
      ? { [`${data.variableName}Attachments`]: cacheAttachments.handling }
      : {}),
    [WORKFLOW_USAGE_KEY]: usage,
  };
};
