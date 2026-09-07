import { definition as aiCompatible } from "./ai/compatible/definition";
import { definition as aiExtract } from "./ai/extract/definition";
import { definition as aiLlm } from "./ai/llm/definition";
import { definition as aiRetrieve } from "./ai/retrieve/definition";
import { definition as airtableCreateRecord } from "./airtable/create-record/definition";
import { definition as airtableRead } from "./airtable/read/definition";
import { definition as airtableTrigger } from "./airtable/trigger/definition";
import { definition as airtableUpdate } from "./airtable/update/definition";
import { definition as apifyGetDataset } from "./apify/get-dataset/definition";
import { definition as apifyRun } from "./apify/run/definition";
import { definition as apolloEnrich } from "./apollo/enrich/definition";
import { definition as bamboohrTrigger } from "./bamboohr/trigger/definition";
import { definition as calendarTrigger } from "./calendar/trigger/definition";
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
import { definition as driveDownload } from "./drive/download/definition";
import { definition as driveMove } from "./drive/move/definition";
import { definition as driveTrigger } from "./drive/trigger/definition";
import { definition as driveUpload } from "./drive/upload/definition";
import { definition as emailSend } from "./email/send/definition";
import { definition as filesDownload } from "./files/download/definition";
import { definition as filesExtractText } from "./files/extract-text/definition";
import { definition as filesHtmlToPdf } from "./files/html-to-pdf/definition";
import { definition as formsGoogleForm } from "./forms/google-form/definition";
import { definition as formsHostedForm } from "./forms/hosted-form/definition";
import { definition as githubCreatePr } from "./github/create-pr/definition";
import { definition as githubListCommits } from "./github/list-commits/definition";
import { definition as githubSearchPrs } from "./github/search-prs/definition";
import { definition as githubTrigger } from "./github/trigger/definition";
import { definition as gmailSend } from "./gmail/send/definition";
import { definition as gmailTrigger } from "./gmail/trigger/definition";
import { definition as googleMapsSearch } from "./google-search/maps/definition";
import { definition as googleSearch } from "./google-search/search/definition";
import { definition as googleSheetsAppend } from "./google-sheets/append/definition";
import { definition as googleSheetsRead } from "./google-sheets/read/definition";
import { definition as googleSheetsTrigger } from "./google-sheets/trigger/definition";
import { definition as googleSheetsUpdate } from "./google-sheets/update/definition";
import { definition as googleSheetsUpsert } from "./google-sheets/upsert/definition";
import { definition as httpHttpRequest } from "./http/request/definition";
import { definition as hubspotCreateContact } from "./hubspot/create-contact/definition";
import { definition as jiraAddAttachment } from "./jira/add-attachment/definition";
import { definition as jiraCreateIssue } from "./jira/create-issue/definition";
import { definition as jiraSearch } from "./jira/search/definition";
import { definition as jiraTransition } from "./jira/transition/definition";
import { definition as mailerliteCreateSubscriber } from "./mailerlite/create-subscriber/definition";
import { definition as mailerliteFindSubscriber } from "./mailerlite/find-subscriber/definition";
import { definition as creatomateRender } from "./media/creatomate-render/definition";
import { definition as openaiImage } from "./media/openai-image/definition";
import { definition as pollinationsImage } from "./media/pollinations-image/definition";
import { definition as veoGenerate } from "./media/veo-generate/definition";
import { definition as notionCreatePage } from "./notion/create-page/definition";
import { definition as notionQueryDatabase } from "./notion/query-database/definition";
import { definition as stripeCreatePaymentLink } from "./payments/stripe-create-payment-link/definition";
import { definition as stripeFindOrCreateCustomer } from "./payments/stripe-find-or-create-customer/definition";
import { definition as stripeGetCustomer } from "./payments/stripe-get-customer/definition";
import { definition as paymentsStripeTrigger } from "./payments/stripe-trigger/definition";
import { definition as peopleBackgroundCheck } from "./people/background-check/definition";
import { definition as peopleBenefitsEnrollment } from "./people/benefits-enrollment/definition";
import { definition as peopleCandidateSchedule } from "./people/candidate-schedule/definition";
import { definition as peopleCandidateScoreRank } from "./people/candidate-score-rank/definition";
import { definition as peopleEmployeeActive } from "./people/employee-active/definition";
import { definition as peopleEmployeeHired } from "./people/employee-hired/definition";
import { definition as peopleEmployeeOffboarded } from "./people/employee-offboarded/definition";
import { definition as peopleEmployeeOffboarding } from "./people/employee-offboarding/definition";
import { definition as peopleEmployeeOnboarding } from "./people/employee-onboarding/definition";
import { definition as peopleExitInterview } from "./people/exit-interview/definition";
import { definition as peopleIllnessSummary } from "./people/illness-summary/definition";
import { definition as peopleNegotiationIqSummary } from "./people/negotiation-iq-summary/definition";
import { definition as peopleOffboardingChecklist } from "./people/offboarding-checklist/definition";
import { definition as peopleOfferLetter } from "./people/offer-letter/definition";
import { definition as peopleOnboardingChecklist } from "./people/onboarding-checklist/definition";
import { definition as peopleOrientation } from "./people/orientation/definition";
import { definition as postgresQuery } from "./postgres/query/definition";
import { definition as qboAttach } from "./quickbooks/attach/definition";
import { definition as qboCreateCustomer } from "./quickbooks/create-customer/definition";
import { definition as qboCreateEstimate } from "./quickbooks/create-estimate/definition";
import { definition as qboCreateExpense } from "./quickbooks/create-expense/definition";
import { definition as qboCreateInvoice } from "./quickbooks/create-invoice/definition";
import { definition as qboCreateSalesReceipt } from "./quickbooks/create-sales-receipt/definition";
import { definition as qboFindCustomer } from "./quickbooks/find-customer/definition";
import { definition as qboGet } from "./quickbooks/get/definition";
import { definition as qboInvoicePdf } from "./quickbooks/get-invoice-pdf/definition";
import { definition as qboWebhookTrigger } from "./quickbooks/webhook-trigger/definition";
import { definition as shopifyCreateOrder } from "./shopify/create-order/definition";
import { definition as slackCreateChannel } from "./slack/create-channel/definition";
import { definition as slackDmByEmail } from "./slack/dm-by-email/definition";
import { definition as slackInvite } from "./slack/invite/definition";
import { definition as slackListChannels } from "./slack/list-channels/definition";
import { definition as slackPost } from "./slack/post/definition";
import { definition as slackSendMessage } from "./slack/send-message/definition";
import { definition as linkedinPost } from "./social/linkedin-post/definition";
import { definition as uploadPostPublish } from "./social/upload-post-publish/definition";
import { definition as xPost } from "./social/x-post/definition";
import { definition as youtubeUpload } from "./social/youtube-upload/definition";
import { definition as telegramGetFile } from "./telegram/get-file/definition";
import { definition as telegramSendMessage } from "./telegram/send-message/definition";
import { definition as telegramTrigger } from "./telegram/trigger/definition";
import type { NodeDefinition } from "./types";
import { definition as wahaSendMessage } from "./waha/send-message/definition";
import { definition as wahaTrigger } from "./waha/trigger/definition";
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
  coreDataTable,
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
  bamboohrTrigger,
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
  peopleEmployeeOffboarded,
  peopleEmployeeOffboarding,
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
