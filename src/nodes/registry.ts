import "server-only";
import aiCompatible from "./ai/compatible";
import aiExtract from "./ai/extract";
import aiLlm from "./ai/llm";
import aiRetrieve from "./ai/retrieve";
import airtableCreateRecord from "./airtable/create-record";
import airtableRead from "./airtable/read";
import airtableTrigger from "./airtable/trigger";
import airtableUpdate from "./airtable/update";
import apifyGetDataset from "./apify/get-dataset";
import apifyRun from "./apify/run";
import apolloEnrich from "./apollo/enrich";
import calendarTrigger from "./calendar/trigger";
import coreAggregate from "./core/aggregate";
import coreApproval from "./core/approval";
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
import driveDownload from "./drive/download";
import driveMove from "./drive/move";
import driveTrigger from "./drive/trigger";
import driveUpload from "./drive/upload";
import emailSend from "./email/send";
import filesDownload from "./files/download";
import filesExtractText from "./files/extract-text";
import filesHtmlToPdf from "./files/html-to-pdf";
import formsGoogleForm from "./forms/google-form";
import formsHostedForm from "./forms/hosted-form";
import githubCreatePr from "./github/create-pr";
import githubListCommits from "./github/list-commits";
import githubSearchPrs from "./github/search-prs";
import githubTrigger from "./github/trigger";
import gmailSend from "./gmail/send";
import gmailTrigger from "./gmail/trigger";
import googleMapsSearch from "./google-search/maps";
import googleSearch from "./google-search/search";
import googleSheetsAppend from "./google-sheets/append";
import googleSheetsRead from "./google-sheets/read";
import googleSheetsTrigger from "./google-sheets/trigger";
import googleSheetsUpdate from "./google-sheets/update";
import googleSheetsUpsert from "./google-sheets/upsert";
import httpHttpRequest from "./http/request";
import hubspotCreateContact from "./hubspot/create-contact";
import jiraAddAttachment from "./jira/add-attachment";
import jiraCreateIssue from "./jira/create-issue";
import jiraSearch from "./jira/search";
import jiraTransition from "./jira/transition";
import mailerliteCreateSubscriber from "./mailerlite/create-subscriber";
import mailerliteFindSubscriber from "./mailerlite/find-subscriber";
import creatomateRender from "./media/creatomate-render";
import openaiImage from "./media/openai-image";
import pollinationsImage from "./media/pollinations-image";
import veoGenerate from "./media/veo-generate";
import notionCreatePage from "./notion/create-page";
import notionQueryDatabase from "./notion/query-database";
import stripeCreatePaymentLink from "./payments/stripe-create-payment-link";
import stripeFindOrCreateCustomer from "./payments/stripe-find-or-create-customer";
import stripeGetCustomer from "./payments/stripe-get-customer";
import paymentsStripeTrigger from "./payments/stripe-trigger";
import peopleBackgroundCheck from "./people/background-check";
import peopleBenefitsEnrollment from "./people/benefits-enrollment";
import peopleCandidateSchedule from "./people/candidate-schedule";
import peopleCandidateScoreRank from "./people/candidate-score-rank";
import peopleEmployeeActive from "./people/employee-active";
import peopleEmployeeHired from "./people/employee-hired";
import peopleEmployeeOnboarding from "./people/employee-onboarding";
import peopleExitInterview from "./people/exit-interview";
import peopleIllnessSummary from "./people/illness-summary";
import peopleNegotiationIqSummary from "./people/negotiation-iq-summary";
import peopleOffboardingChecklist from "./people/offboarding-checklist";
import peopleOfferLetter from "./people/offer-letter";
import peopleOnboardingChecklist from "./people/onboarding-checklist";
import peopleOrientation from "./people/orientation";
import postgresQuery from "./postgres/query";
import qboAttach from "./quickbooks/attach";
import qboCreateCustomer from "./quickbooks/create-customer";
import qboCreateEstimate from "./quickbooks/create-estimate";
import qboCreateExpense from "./quickbooks/create-expense";
import qboCreateInvoice from "./quickbooks/create-invoice";
import qboCreateSalesReceipt from "./quickbooks/create-sales-receipt";
import qboFindCustomer from "./quickbooks/find-customer";
import qboGet from "./quickbooks/get";
import qboInvoicePdf from "./quickbooks/get-invoice-pdf";
import qboWebhookTrigger from "./quickbooks/webhook-trigger";
import shopifyCreateOrder from "./shopify/create-order";
import slackCreateChannel from "./slack/create-channel";
import slackDmByEmail from "./slack/dm-by-email";
import slackInvite from "./slack/invite";
import slackListChannels from "./slack/list-channels";
import slackPost from "./slack/post";
import slackSendMessage from "./slack/send-message";
import linkedinPost from "./social/linkedin-post";
import uploadPostPublish from "./social/upload-post-publish";
import xPost from "./social/x-post";
import youtubeUpload from "./social/youtube-upload";
import telegramGetFile from "./telegram/get-file";
import telegramSendMessage from "./telegram/send-message";
import telegramTrigger from "./telegram/trigger";
import type { NodeCategory, NodeRegistration } from "./types";
import wahaSendMessage from "./waha/send-message";
import wahaTrigger from "./waha/trigger";
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
    coreApproval,
    coreRespondToWebhook,
    formsGoogleForm,
    formsHostedForm,
    googleSheetsAppend,
    googleSheetsRead,
    googleSheetsUpdate,
    googleSheetsUpsert,
    googleSheetsTrigger,
    gmailSend,
    gmailTrigger,
    driveTrigger,
    driveDownload,
    driveUpload,
    driveMove,
    calendarTrigger,
    qboAttach,
    qboCreateCustomer,
    qboCreateEstimate,
    qboCreateExpense,
    qboCreateInvoice,
    qboCreateSalesReceipt,
    qboFindCustomer,
    qboGet,
    qboInvoicePdf,
    qboWebhookTrigger,
    slackPost,
    slackListChannels,
    slackCreateChannel,
    slackInvite,
    slackDmByEmail,
    githubTrigger,
    githubCreatePr,
    githubListCommits,
    githubSearchPrs,
    jiraCreateIssue,
    jiraTransition,
    jiraSearch,
    jiraAddAttachment,
    notionCreatePage,
    notionQueryDatabase,
    apifyRun,
    apifyGetDataset,
    apolloEnrich,
    googleSearch,
    googleMapsSearch,
    airtableRead,
    airtableUpdate,
    airtableTrigger,
    shopifyCreateOrder,
    mailerliteFindSubscriber,
    mailerliteCreateSubscriber,
    stripeFindOrCreateCustomer,
    stripeCreatePaymentLink,
    stripeGetCustomer,
    telegramTrigger,
    telegramSendMessage,
    telegramGetFile,
    wahaTrigger,
    wahaSendMessage,
    xPost,
    linkedinPost,
    youtubeUpload,
    uploadPostPublish,
    openaiImage,
    pollinationsImage,
    veoGenerate,
    creatomateRender,
    airtableCreateRecord,
    hubspotCreateContact,
    paymentsStripeTrigger,
    peopleBackgroundCheck,
    peopleBenefitsEnrollment,
    peopleCandidateSchedule,
    peopleCandidateScoreRank,
    peopleEmployeeActive,
    peopleEmployeeHired,
    peopleEmployeeOnboarding,
    peopleExitInterview,
    peopleIllnessSummary,
    peopleNegotiationIqSummary,
    peopleOffboardingChecklist,
    peopleOfferLetter,
    peopleOnboardingChecklist,
    peopleOrientation,
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
