import "server-only";
import aiCompatible from "./ai/compatible";
import aiExtract from "./ai/extract";
import aiLlm from "./ai/llm";
import aiRetrieve from "./ai/retrieve";
import airtableCreateRecord from "./airtable/create-record";
import coreAggregate from "./core/aggregate";
import coreCode from "./core/code";
import coreCondition from "./core/condition";
import coreDedupe from "./core/dedupe";
import coreFilter from "./core/filter";
import coreManualTrigger from "./core/manual-trigger";
import coreMerge from "./core/merge";
import coreRespondToWebhook from "./core/respond-to-webhook";
import coreScheduleTrigger from "./core/schedule-trigger";
import coreSet from "./core/set";
import coreSplitOut from "./core/split-out";
import coreSwitch from "./core/switch";
import coreWait from "./core/wait";
import coreWebhookTrigger from "./core/webhook-trigger";
import discordSendMessage from "./discord/send-message";
import emailSend from "./email/send";
import filesDownload from "./files/download";
import filesExtractText from "./files/extract-text";
import filesHtmlToPdf from "./files/html-to-pdf";
import formsGoogleForm from "./forms/google-form";
import formsHostedForm from "./forms/hosted-form";
import googleSheetsAppend from "./google-sheets/append";
import httpHttpRequest from "./http/request";
import hubspotCreateContact from "./hubspot/create-contact";
import paymentsStripeTrigger from "./payments/stripe-trigger";
import postgresQuery from "./postgres/query";
import slackSendMessage from "./slack/send-message";
import type { NodeCategory, NodeRegistration } from "./types";
import webhookOut from "./webhook/out";

/**
 * Server-side node registry (AF-M1-01). Imports full registrations
 * (definition + execute); the client-safe counterpart is `manifest.ts`.
 *
 * Malformed definitions and duplicate ids fail HERE, at construction — a bad
 * node folder cannot half-register and surprise the engine at run time.
 */

const VALID_CATEGORIES: NodeCategory[] = [
  "TRIGGER",
  "ACTION",
  "LOGIC",
  "AI",
  "DATA",
  "TRANSFORM",
];

export class UnknownNodeTypeError extends Error {
  constructor(type: string, known: string[]) {
    super(
      `Unknown node type: "${type}". Registered types: ${known.join(", ")}`,
    );
    this.name = "UnknownNodeTypeError";
  }
}

export interface NodeRegistry {
  /** Registration for a type id or alias; throws UnknownNodeTypeError. */
  resolve: (type: string) => NodeRegistration;
  has: (type: string) => boolean;
  /** Every registered definition (aliases excluded). */
  list: () => NodeRegistration[];
}

function validateRegistration(registration: NodeRegistration): void {
  const where = `node "${registration?.type ?? "<missing type>"}"`;

  if (!registration.execute || typeof registration.execute !== "function") {
    throw new Error(`${where}: missing execute implementation`);
  }
  if (typeof registration.type !== "string" || registration.type.length === 0) {
    throw new Error(`${where}: "type" must be a non-empty string`);
  }
  if (!Number.isInteger(registration.version) || registration.version < 1) {
    throw new Error(`${where}: "version" must be an integer >= 1`);
  }
  if (!VALID_CATEGORIES.includes(registration.category)) {
    throw new Error(
      `${where}: invalid category "${String(registration.category)}"`,
    );
  }
  if (
    typeof registration.label !== "string" ||
    registration.label.length === 0
  ) {
    throw new Error(`${where}: "label" is required`);
  }
  if (
    typeof registration.description !== "string" ||
    registration.description.length === 0
  ) {
    throw new Error(`${where}: "description" is required`);
  }
  if (
    !registration.configSchema ||
    typeof registration.configSchema.parse !== "function"
  ) {
    throw new Error(`${where}: "configSchema" must be a Zod schema`);
  }
  if (!Array.isArray(registration.inputs)) {
    throw new Error(
      `${where}: "inputs" must be an array (use [] for triggers)`,
    );
  }
  if (!Array.isArray(registration.outputs)) {
    throw new Error(`${where}: "outputs" must be an array`);
  }
}

export function createNodeRegistry(
  registrations: NodeRegistration[],
  options: { aliases?: Record<string, string> } = {},
): NodeRegistry {
  const byType = new Map<string, NodeRegistration>();
  const aliasTarget = new Map<string, string>();

  for (const registration of registrations) {
    validateRegistration(registration);
    if (byType.has(registration.type)) {
      throw new Error(
        `Duplicate node type: "${registration.type}" is registered more than once`,
      );
    }
    byType.set(registration.type, registration);
  }

  if (options.aliases) {
    for (const [alias, target] of Object.entries(options.aliases)) {
      if (byType.has(alias)) {
        throw new Error(`Alias "${alias}" collides with a registered type`);
      }
      if (!byType.has(target)) {
        throw new Error(
          `Alias "${alias}" points at unregistered type "${target}"`,
        );
      }
      aliasTarget.set(alias, target);
    }
  }

  return {
    resolve(type: string): NodeRegistration {
      const direct = byType.get(type);
      if (direct) {
        return direct;
      }
      const viaAlias = aliasTarget.get(type);
      if (viaAlias) {
        return byType.get(viaAlias) as NodeRegistration;
      }
      throw new UnknownNodeTypeError(type, [...byType.keys()]);
    },
    has: (type: string) => byType.has(type) || aliasTarget.has(type),
    list: () => [...byType.values()],
  };
}

/**
 * The production registry. Legacy note: INITIAL was the tutorial's
 * placeholder trigger and behaves identically to MANUAL_TRIGGER; it stays as
 * an alias until M1-02 migrates persisted rows.
 */
export const nodeRegistry = createNodeRegistry(
  [
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
    coreRespondToWebhook,
    formsGoogleForm,
    formsHostedForm,
    googleSheetsAppend,
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
  ],
  { aliases: { INITIAL: "MANUAL_TRIGGER" } },
);

export const getNodeRegistration = (type: string): NodeRegistration =>
  nodeRegistry.resolve(type);
