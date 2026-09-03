import { definition as aiCompatible } from "./ai/compatible/definition";
import { definition as aiExtract } from "./ai/extract/definition";
import { definition as aiLlm } from "./ai/llm/definition";
import { definition as aiRetrieve } from "./ai/retrieve/definition";
import { definition as airtableCreateRecord } from "./airtable/create-record/definition";
import { definition as coreAggregate } from "./core/aggregate/definition";
import { definition as coreApproval } from "./core/approval/definition";
import { definition as coreCode } from "./core/code/definition";
import { definition as coreCondition } from "./core/condition/definition";
import { definition as coreDedupe } from "./core/dedupe/definition";
import { definition as coreFilter } from "./core/filter/definition";
import { definition as coreManualTrigger } from "./core/manual-trigger/definition";
import { definition as coreMerge } from "./core/merge/definition";
import { definition as coreRespondToWebhook } from "./core/respond-to-webhook/definition";
import { definition as coreScheduleTrigger } from "./core/schedule-trigger/definition";
import { definition as coreSet } from "./core/set/definition";
import { definition as coreSplitOut } from "./core/split-out/definition";
import { definition as coreSwitch } from "./core/switch/definition";
import { definition as coreWait } from "./core/wait/definition";
import { definition as coreWebhookTrigger } from "./core/webhook-trigger/definition";
import { definition as discordSendMessage } from "./discord/send-message/definition";
import { definition as emailSend } from "./email/send/definition";
import { definition as filesDownload } from "./files/download/definition";
import { definition as filesExtractText } from "./files/extract-text/definition";
import { definition as filesHtmlToPdf } from "./files/html-to-pdf/definition";
import { definition as formsGoogleForm } from "./forms/google-form/definition";
import { definition as formsHostedForm } from "./forms/hosted-form/definition";
import { definition as googleSheetsAppend } from "./google-sheets/append/definition";
import { definition as googleSheetsRead } from "./google-sheets/read/definition";
import { definition as googleSheetsTrigger } from "./google-sheets/trigger/definition";
import { definition as googleSheetsUpdate } from "./google-sheets/update/definition";
import { definition as googleSheetsUpsert } from "./google-sheets/upsert/definition";
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
  coreCode,
  coreCondition,
  coreMerge,
  coreSwitch,
  coreSplitOut,
  coreAggregate,
  coreFilter,
  coreDedupe,
  coreWait,
  coreApproval,
  coreRespondToWebhook,
  formsGoogleForm,
  formsHostedForm,
  googleSheetsAppend,
  googleSheetsRead,
  googleSheetsUpdate,
  googleSheetsUpsert,
  googleSheetsTrigger,
  airtableCreateRecord,
  hubspotCreateContact,
  paymentsStripeTrigger,
  postgresQuery,
  httpHttpRequest,
  filesDownload,
  filesExtractText,
  filesHtmlToPdf,
  aiCompatible,
  aiExtract,
  aiLlm,
  aiRetrieve,
  discordSendMessage,
  slackSendMessage,
  emailSend,
  webhookOut,
];

export const findManifestEntry = (type: string): NodeDefinition | undefined =>
  nodeManifest.find((node) => node.type === type);

/**
 * What the palette offers (AF-M5-09). Deprecated types stay in
 * `nodeManifest` — an existing node of that type must still render, validate,
 * and run — but are not offered for insertion, so their population can only
 * shrink. Look types up through `findManifestEntry`, never through this list.
 */
export const nodePalette: NodeDefinition[] = nodeManifest.filter(
  (node) => !node.deprecated,
);
