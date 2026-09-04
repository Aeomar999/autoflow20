import { z } from "zod";
import type { NodeDefinition } from "@/nodes/types";
import {
  credentialIdRef,
  freeText,
  variableNameSchema,
} from "../../shared/config-fields";

export const configSchema = z.object({
  /** Result key in the run context: {{variableName.email.messageId}} */
  variableName: variableNameSchema.optional(),
  /** SMTP credential (host, port, username, password, tls). */
  credentialId: credentialIdRef(),
  /** Sender address. Must be a valid email; errors are config-time, not run-time. */
  from: z.string().email("Invalid from email").optional(),
  /** Optional display name shown alongside the sender address. */
  fromName: freeText(256).optional(),
  /** Recipient addresses, comma-separated. Supports Handlebars templates. */
  to: z.string().max(4096).optional(),
  /** Optional copy recipients, comma-separated. Supports templates. */
  cc: z.string().max(4096).optional(),
  /** Optional blind-copy recipients, comma-separated. */
  bcc: z.string().max(4096).optional(),
  /** Subject line. Supports Handlebars templates. */
  subject: freeText(1024).optional(),
  /** Plain-text body. Supports Handlebars templates. */
  body: freeText(100_000).optional(),
});

export const definition: NodeDefinition = {
  type: "EMAIL_SEND",
  version: 1,
  category: "ACTION",
  label: "Send Email",
  description:
    "Send an email through an SMTP relay and store the delivery result.",
  icon: "Mail",
  logo: "/logos/gmail.png",
  keywords: ["email", "smtp", "notify", "mail", "message"],
  configSchema,
  defaults: {},
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  credentials: [{ key: "credentialId", type: "smtp", required: true }],
};
