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
  /** Phone number in any format, or a full `…@c.us` / `…@g.us` id. */
  chatId: freeText(128).optional(),
  text: freeText(64_000).optional(),
  /** WAHA serves named sessions; "default" is only the default. */
  session: freeText(128).optional(),
});

export const definition: NodeDefinition = {
  type: "WAHA_SEND_MESSAGE",
  version: 1,
  category: "ACTION",
  label: "WhatsApp Send Message (WAHA)",
  description:
    "Send a WhatsApp message through a self-hosted WAHA instance. Phone numbers are normalised to WAHA's chat-id form, which it otherwise accepts silently and never delivers.",
  icon: "MessageSquare",
  logo: "/logos/whatsapp.png",
  keywords: ["whatsapp", "waha", "message", "send", "chat", "sms"],
  configSchema,
  defaults: { session: "default" },
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  credentials: [{ key: "credentialId", type: "waha.apiKey", required: true }],
  docsUrl: "/docs/nodes/WAHA_SEND_MESSAGE",
};
