import { definition as aiAnthropic } from "./ai/anthropic/definition";
import { definition as aiCompatible } from "./ai/compatible/definition";
import { definition as aiGemini } from "./ai/gemini/definition";
import { definition as aiOpenai } from "./ai/openai/definition";
import { definition as airtableCreateRecord } from "./airtable/create-record/definition";
import { definition as coreCondition } from "./core/condition/definition";
import { definition as coreManualTrigger } from "./core/manual-trigger/definition";
import { definition as coreMerge } from "./core/merge/definition";
import { definition as coreScheduleTrigger } from "./core/schedule-trigger/definition";
import { definition as coreSet } from "./core/set/definition";
import { definition as coreWebhookTrigger } from "./core/webhook-trigger/definition";
import { definition as discordSendMessage } from "./discord/send-message/definition";
import { definition as emailSend } from "./email/send/definition";
import { definition as formsGoogleForm } from "./forms/google-form/definition";
import { definition as googleSheetsAppend } from "./google-sheets/append/definition";
import { definition as httpHttpRequest } from "./http/request/definition";
import { definition as hubspotCreateContact } from "./hubspot/create-contact/definition";
import { definition as paymentsStripeTrigger } from "./payments/stripe-trigger/definition";
import { definition as postgresQuery } from "./postgres/query/definition";
import { definition as slackSendMessage } from "./slack/send-message/definition";
import type { NodeDefinition } from "./types";
import { definition as webhookOut } from "./webhook/out/definition";

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
  coreWebhookTrigger,
  coreScheduleTrigger,
  coreSet,
  coreCondition,
  coreMerge,
  formsGoogleForm,
  googleSheetsAppend,
  airtableCreateRecord,
  hubspotCreateContact,
  paymentsStripeTrigger,
  postgresQuery,
  httpHttpRequest,
  aiAnthropic,
  aiCompatible,
  aiGemini,
  aiOpenai,
  discordSendMessage,
  slackSendMessage,
  emailSend,
  webhookOut,
];

export const findManifestEntry = (type: string): NodeDefinition | undefined =>
  nodeManifest.find((node) => node.type === type);
