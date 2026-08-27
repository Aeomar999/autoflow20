import { definition as aiAnthropic } from "./ai/anthropic/definition";
import { definition as aiGemini } from "./ai/gemini/definition";
import { definition as aiOpenai } from "./ai/openai/definition";
import { definition as coreManualTrigger } from "./core/manual-trigger/definition";
import { definition as discordSendMessage } from "./discord/send-message/definition";
import { definition as formsGoogleForm } from "./forms/google-form/definition";
import { definition as httpHttpRequest } from "./http/request/definition";
import { definition as paymentsStripeTrigger } from "./payments/stripe-trigger/definition";
import { definition as slackSendMessage } from "./slack/send-message/definition";
import type { NodeDefinition } from "./types";

/**
 * Client-safe view of the node catalogue (AF-M1-01).
 *
 * This file imports ONLY `definition.ts` modules — never `execute.ts`, never
 * `registry.ts`. The bundler therefore cannot pull a server implementation
 * into the browser bundle through this entry point, regardless of what a
 * client component imports. `registry.test.ts` asserts that invariant
 * statically; keep it true.
 */
export const nodeManifest: NodeDefinition[] = [
  coreManualTrigger,
  formsGoogleForm,
  paymentsStripeTrigger,
  httpHttpRequest,
  aiAnthropic,
  aiGemini,
  aiOpenai,
  discordSendMessage,
  slackSendMessage,
];

export const findManifestEntry = (type: string): NodeDefinition | undefined =>
  nodeManifest.find((node) => node.type === type);
