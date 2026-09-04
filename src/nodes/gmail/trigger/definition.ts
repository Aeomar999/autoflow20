import { z } from "zod";
import type { NodeDefinition } from "@/nodes/types";
import { credentialIdRef, freeText } from "../../shared/config-fields";
import { GMAIL_CREDENTIAL_TYPE } from "../send/definition";

export const configSchema = z.object({
  credentialId: credentialIdRef(),
  /**
   * Gmail search query, e.g. `is:unread from:invoices@acme.com has:attachment`.
   * Anything the Gmail search box accepts works here.
   */
  query: freeText(2048).optional(),
  /** Restrict to labels, comma-separated (`INBOX`, `IMPORTANT`, a label id). */
  labelIds: freeText(1024).optional(),
  pollIntervalSeconds: z.number().int().min(60).max(86_400).optional(),
});

export const definition: NodeDefinition = {
  type: "GMAIL_TRIGGER",
  version: 1,
  category: "TRIGGER",
  label: "Gmail New Message",
  description:
    "Start the workflow for each new message matching a Gmail search. Messages already in the mailbox when the trigger is activated are not replayed.",
  icon: "Mail",
  logo: "/logos/gmail.png",
  keywords: ["gmail", "google", "email", "trigger", "inbox", "poll", "unread"],
  configSchema,
  defaults: { query: "is:unread", pollIntervalSeconds: 300 },
  inputs: [],
  outputs: [{ id: "main", label: "Out" }],
  credentials: [
    { key: "credentialId", type: GMAIL_CREDENTIAL_TYPE, required: true },
  ],
  docsUrl: "/docs/nodes/GMAIL_TRIGGER",
};
