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
});

export const definition: NodeDefinition = {
  type: "MAILERLITE_FIND_SUBSCRIBER",
  version: 1,
  category: "DATA",
  label: "MailerLite Find Subscriber",
  description:
    "Look a subscriber up by email. A miss is reported as found: false rather than failing, and the subscriber's status is returned — someone who unsubscribed still exists.",
  icon: "UserSearch",
  logo: "/logos/mailerlite.svg",
  keywords: ["mailerlite", "subscriber", "find", "lookup", "email", "list"],
  configSchema,
  defaults: {},
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  credentials: [
    { key: "credentialId", type: "mailerlite.apiKey", required: true },
  ],
  docsUrl: "/docs/nodes/MAILERLITE_FIND_SUBSCRIBER",
};
