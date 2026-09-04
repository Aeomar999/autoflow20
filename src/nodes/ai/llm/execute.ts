import "server-only";
import { generateObject, generateText, jsonSchema } from "ai";
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
import { definition, type LlmData } from "./definition";

const DEFAULT_SYSTEM_PROMPT =
  "You are a helpful automation assistant operating inside an AutoFlow workflow.";

export const execute: NodeRun<LlmData> = async ({
  data,
  context,
  resolve,
  organizationId,
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
    ? resolve(data.systemPrompt).trim()
    : DEFAULT_SYSTEM_PROMPT;
  const resolvedPrompt = resolve(data.userPrompt).trim();

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

  // AF-M10-07. Resolved once, before the cache key, because the bytes are part
  // of what the answer depends on. `attachments` is rendered here and read per
  // candidate inside the call, since PDF handling differs by provider.
  const renderedAttachments = data.attachments
    ? resolve(data.attachments).trim()
    : "";
  const hasAttachments = renderedAttachments.length > 0;

  if (hasAttachments) {
    if (!organizationId) {
      throw new NonRetriableError(
        "AI Chat node: this run has no organization, so its attachments cannot be read.",
      );
    }
    // Re-checked at run time as well as at save time: a fallback chain can be
    // edited to add a text-only model after the attachment was configured, and
    // answering confidently about an image the model never saw is the failure
    // this prevents.
    assertVisionCapable(candidates, "AI Chat node");
  }

  // The bytes are resolved per candidate (PDF handling is provider-specific),
  // but the CONTENT hashes are not — so they are read once, from the primary,
  // to key the cache. Two different invoices must not share an entry.
  const cacheAttachments = hasAttachments
    ? await resolveAttachments({
        rendered: renderedAttachments,
        organizationId: organizationId as string,
        adapter: "openai",
        where: "AI Chat node",
      })
    : EMPTY_ATTACHMENTS;

  // AF-M5-07: the fingerprint covers everything that can change the answer —
  // a temperature or schema edit misses rather than replaying the old reply.
  const cacheTtlSeconds = normalizeCacheTtlSeconds(data.cacheTtlSeconds);
  const cacheKey = buildAiCacheKey({
    nodeType: definition.type,
    candidates,
    system: resolvedSystem,
    prompt: resolvedPrompt,
    params: {
      temperature: callSettings.temperature,
      maxTokens: data.maxTokens,
      jsonMode: data.jsonMode === true,
      jsonSchema: data.jsonMode ? (parsedSchema ?? null) : null,
      // AF-M10-07: content hashes, not file ids. Two copies of one invoice
      // SHOULD share a cache entry; two different invoices must not, and their
      // ids differ on every upload while their bytes do not.
      attachmentSha256s: cacheAttachments.sha256s,
    },
  });

  const {
    result: text,
    servedModel,
    usage,
  } = await executeWithFallback(
    candidates,
    credentials,
    "AI Chat node",
    async (candidate) => {
      // Per candidate: the primary may read PDFs natively while its fallback
      // does not, and sending a fallback a payload it cannot use would be a
      // silently worse answer.
      const attachments = hasAttachments
        ? await resolveAttachments({
            rendered: renderedAttachments,
            organizationId: organizationId as string,
            adapter: candidate.modelDef.adapter,
            where: "AI Chat node",
          })
        : EMPTY_ATTACHMENTS;

      // Text pulled out of a document this provider cannot read natively is
      // appended rather than dropped, so the model still sees the content.
      const promptText = attachments.extractedText
        ? `${resolvedPrompt}

${attachments.extractedText}`
        : resolvedPrompt;

      // The `ai` SDK takes either a `prompt` string or a `messages` array;
      // parts require the array form.
      const promptArgs =
        attachments.parts.length > 0
          ? {
              messages: [
                {
                  role: "user" as const,
                  content: [
                    { type: "text" as const, text: promptText },
                    ...attachments.parts,
                  ],
                },
              ],
            }
          : { prompt: promptText };

      if (data.jsonMode && parsedSchema) {
        const result = await step.ai.wrap(
          `llm-generate-object:${candidate.fullModelId}`,
          generateObject,
          {
            model: candidate.languageModel,
            system: resolvedSystem,
            ...promptArgs,
            schema: jsonSchema(parsedSchema),
            ...callSettings,
          } as Parameters<typeof generateObject>[0],
        );
        const object = (result as { object?: unknown }).object ?? null;
        const resUsage = pickRunUsage(result);
        return {
          value: JSON.stringify(object, null, 2),
          usage: resUsage,
        };
      }

      const result = await step.ai.wrap(
        `llm-generate-text:${candidate.fullModelId}`,
        generateText,
        {
          model: candidate.languageModel,
          system: resolvedSystem,
          ...promptArgs,
          ...callSettings,
        } as Parameters<typeof generateText>[0],
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
      const resUsage = pickRunUsage(result);
      return {
        value: resText,
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
    [data.variableName as string]: {
      text,
      model: servedModel,
      // AF-M10-07: which path each attachment took. A PDF read as extracted
      // text reads worse than one read natively, and this is how a user sees
      // that rather than guessing.
      ...(hasAttachments ? { attachments: cacheAttachments.handling } : {}),
    },
    [WORKFLOW_USAGE_KEY]: usage,
  };
};
