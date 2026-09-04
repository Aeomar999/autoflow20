import { z } from "zod";
import type { NodeDefinition } from "@/nodes/types";
import {
  credentialIdRef,
  freeText,
  variableNameSchema,
} from "../../shared/config-fields";

/** Scoped Gmail type, or the deprecated one during its overlap (ADR-0023). */
export const GMAIL_CREDENTIAL_TYPE = "google.gmail|google.oauth2";

export const configSchema = z.object({
  variableName: variableNameSchema.optional(),
  credentialId: credentialIdRef(),
  /** Sender. Must be an address the connected account may send as. */
  from: freeText(320).optional(),
  /** Recipients, comma-separated. Templated. */
  to: freeText(4096).optional(),
  cc: freeText(4096).optional(),
  bcc: freeText(4096).optional(),
  subject: freeText(998).optional(),
  /** HTML body. Takes precedence over `text` when both are set. */
  html: freeText(200_000).optional(),
  /** Plain-text body. */
  text: freeText(200_000).optional(),
  /**
   * Template resolving to one or more `FileRef`s to attach — three braces, as
   * `{{{json report.file}}}`.
   */
  attachments: freeText(8192).optional(),
  /** Reply within an existing thread. */
  threadId: freeText(256).optional(),
  /** `Message-ID` of the message being replied to. */
  inReplyTo: freeText(998).optional(),
});

export const definition: NodeDefinition = {
  type: "GMAIL_SEND",
  version: 1,
  category: "ACTION",
  label: "Gmail Send",
  description:
    "Send mail from the connected Gmail account, with HTML and file attachments.",
  icon: "Mail",
  logo: "/logos/gmail.png",
  keywords: ["gmail", "google", "email", "send", "mail", "reply"],
  configSchema,
  defaults: {},
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  credentials: [
    { key: "credentialId", type: GMAIL_CREDENTIAL_TYPE, required: true },
  ],
  docsUrl: "/docs/nodes/GMAIL_SEND",
};
