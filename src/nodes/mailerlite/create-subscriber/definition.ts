import { z } from "zod";
import type { NodeDefinition } from "@/nodes/types";
import {
  credentialIdRef,
  freeText,
  variableNameSchema,
} from "../../shared/config-fields";

export const configSchema = z.object({
  variableName: variableNameSchema.optional(),
  credentialId: credentialIdRef(),
  email: freeText(320).optional(),
  /** JSON object of MailerLite field names to values, e.g. name, company. */
  fields: freeText(16_384).optional(),
  /** Comma-separated MailerLite group ids. */
  groupIds: freeText(2048).optional(),
});

export const definition: NodeDefinition = {
  type: "MAILERLITE_CREATE_SUBSCRIBER",
  version: 1,
  category: "ACTION",
  label: "MailerLite Add Subscriber",
  description:
    "Add a subscriber and put them in groups. MailerLite matches on email and updates rather than duplicating, so re-running is safe — but it will not resubscribe someone who opted out.",
  icon: "UserPlus",
  logo: "/logos/mailerlite.svg",
  keywords: ["mailerlite", "subscriber", "add", "group", "list", "signup"],
  configSchema,
  defaults: {},
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  credentials: [
    { key: "credentialId", type: "mailerlite.apiKey", required: true },
  ],
  docsUrl: "/docs/nodes/MAILERLITE_CREATE_SUBSCRIBER",
};
