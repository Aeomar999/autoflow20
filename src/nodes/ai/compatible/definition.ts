import { z } from "zod";
import type { NodeDefinition } from "@/nodes/types";
import {
  credentialIdRef,
  freeText,
  promptSchema,
  urlTemplate,
  variableNameSchema,
} from "../../shared/config-fields";

/**
 * Any provider fronting OpenAI's Chat Completions /v1/chat/completions shape:
 * OpenAI, Groq, Ollama, DeepSeek, Together, OpenRouter, local servers
 * (vLLM/LM Studio). baseUrl and userPrompt are template-compiled at run time;
 * baseUrl is SSRF-checked by the egress guard before any request leaves the
 * runner.
 *
 * **OpenRouter runs through here rather than as its own node or provider**
 * (AF-M10-23). It is OpenAI-compatible, so a second implementation would be a
 * copy that drifts: point `baseUrl` at https://openrouter.ai/api/v1, put the
 * OpenRouter model id in `model` (e.g. `meta-llama/llama-3.3-70b-instruct`),
 * and bind an OpenRouter key. The credential requirement accepts either type
 * for exactly that reason.
 */
export const configSchema = z.object({
  /** Result key in the run context: {{variableName.text}} */
  variableName: variableNameSchema.optional(),
  /** OpenAI-compatible API key credential. */
  credentialId: credentialIdRef(),
  /** Base URL of the compatible API, e.g. https://api.groq.com/openai/v1 */
  baseUrl: urlTemplate(2048).optional(),
  /** Model id, e.g. "llama-3.3-70b-versatile" or "gpt-4o". */
  model: freeText(256).optional(),
  /** Optional system prompt; template-compiled at run time. */
  systemPrompt: promptSchema(),
  /** User prompt; template-compiled at run time. */
  userPrompt: promptSchema(),
});

export const definition: NodeDefinition = {
  type: "OPENAI_COMPATIBLE_CHAT",
  version: 1,
  category: "AI",
  label: "OpenAI-Compatible",
  description:
    "Send a chat completion to any OpenAI-compatible endpoint (OpenAI, Groq, Ollama, DeepSeek) and store the reply.",
  icon: "Bot",
  keywords: [
    "openai",
    "compatible",
    "groq",
    "ollama",
    "deepseek",
    "openrouter",
    "llama",
    "llm",
    "chat",
    "completion",
    "ai",
  ],
  configSchema,
  defaults: {},
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  credentials: [
    {
      key: "credentialId",
      // Either type: an OpenRouter key IS an OpenAI-compatible key, and
      // forcing users to re-enter it under a second type would be paperwork
      // rather than a distinction.
      type: "openaiCompatible.apiKey|openrouter.apiKey",
      required: true,
    },
  ],
};
