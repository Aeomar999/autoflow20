import { z } from "zod";
import type { NodeDefinition } from "@/nodes/types";
import {
  cacheTtlSecondsSchema,
  credentialIdRef,
  freeText,
  promptSchema,
  variableNameSchema,
} from "../../shared/config-fields";

/**
 * Model selector accepts either a bare provider id (resolves to that
 * provider's default) or a `provider:model` pair — the values the M5-06
 * editor picker will offer. Single-token so the config form renders it as a
 * plain input today.
 */
const modelIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9._:\-\/]+$/, "Model must be a provider or provider:model id")
  .max(120);

export const configSchema = z.object({
  variableName: variableNameSchema.optional(),
  model: modelIdSchema.optional(),
  fallbackModels: z.string().max(500).optional(),
  openaiCredentialId: credentialIdRef(),
  anthropicCredentialId: credentialIdRef(),
  geminiCredentialId: credentialIdRef(),
  groqCredentialId: credentialIdRef(),
  systemPrompt: promptSchema(),
  userPrompt: promptSchema(),
  /**
   * (AF-M10-07) Template resolving to one or more `FileRef`s — usually
   * `{{{json download.file}}}`. Three braces, not two: two renders the
   * reference as `[object Object]`.
   *
   * Every model in the chain must declare the `vision` capability, checked at
   * SAVE time. A PDF goes to the provider natively where it can read one and
   * as extracted text where it cannot; the node's output records which.
   */
  attachments: freeText(8192).optional(),

  temperature: z.number().min(0).max(2).default(0.7),
  maxTokens: z.number().int().min(1).max(200_000).optional(),
  jsonMode: z.boolean().default(false),
  jsonSchema: z.string().max(100_000).optional(),
  cacheTtlSeconds: cacheTtlSecondsSchema(),
});

export type LlmData = z.infer<typeof configSchema>;

export const definition: NodeDefinition = {
  type: "AI_LLM",
  version: 1,
  category: "AI",
  label: "AI Chat",
  description:
    "Send a prompt to any registered LLM provider (OpenAI, Anthropic, Gemini, Groq, DeepSeek, Ollama) and store the response, or return structured JSON for downstream nodes.",
  icon: "Sparkles",
  keywords: [
    "ai",
    "llm",
    "chat",
    "prompt",
    "openai",
    "anthropic",
    "claude",
    "gemini",
    "groq",
    "deepseek",
    "ollama",
    "json",
  ],
  configSchema,
  defaults: {},
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  supportsResponseCache: true,
  credentials: [
    { key: "openaiCredentialId", type: "openai.apiKey", required: false },
    { key: "anthropicCredentialId", type: "anthropic.apiKey", required: false },
    { key: "geminiCredentialId", type: "gemini.apiKey", required: false },
    // Groq is OpenAI-compatible but a separate account: its models
    // resolve `groqCredentialId`, never the OpenAI one. Without this
    // the fallback chain cannot authenticate against Groq at all.
    { key: "groqCredentialId", type: "groq.apiKey", required: false },
  ],
};
