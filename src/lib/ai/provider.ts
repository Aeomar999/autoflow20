import "server-only";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import type { AiAdapter } from "./registry";

/**
 * Local-mode placeholder API key: some OpenAI-compatible endpoints (ollama)
 * ignore the key entirely but still reject an empty value. The credential gate
 * means this can never reach a keyed provider.
 */
const LOCAL_FAKE_KEY = "local";

export interface CreateLanguageModelOptions {
  adapter: AiAdapter;
  /** Bare model id (no provider prefix), e.g. "gpt-4o". */
  modelId: string;
  apiKey: string | undefined;
  /** OpenAI-compatible base URL for groq/deepseek/ollama (registry baseUrl). */
  baseUrl?: string;
}

/**
 * Builds an AI SDK `LanguageModel` for a registered model def (AF-M5-02).
 * The adapter decides the vendor SDK; the OpenAI-compatible vendors
 * (groq/deepseek/ollama) ride `createOpenAI({ baseURL })`.
 */
export function createLanguageModel({
  adapter,
  modelId,
  apiKey,
  baseUrl,
}: CreateLanguageModelOptions): LanguageModel {
  const key = apiKey ?? LOCAL_FAKE_KEY;
  switch (adapter) {
    case "openai":
      return createOpenAI({ apiKey: key, baseURL: baseUrl })(modelId);
    case "anthropic":
      return createAnthropic({ apiKey: key })(modelId);
    case "google":
      return createGoogleGenerativeAI({ apiKey: key })(modelId);
  }
}
