import { z } from "zod";
import type { NodeDefinition } from "@/nodes/types";
import { credentialIdRef, freeText } from "../../shared/config-fields";

export const configSchema = z.object({
  credentialId: credentialIdRef().optional(),
  session: freeText(128).optional(),
  /** Comma-separated chat ids. Blank accepts any chat. */
  allowedChatIds: freeText(1024).optional(),
});

export const definition: NodeDefinition = {
  type: "WAHA_TRIGGER",
  version: 1,
  category: "TRIGGER",
  label: "WhatsApp Trigger (WAHA)",
  description:
    "Start a workflow when a WhatsApp message arrives. The bot's own outbound messages are dropped, so a workflow that replies does not reply to itself.",
  icon: "MessageSquare",
  logo: "/logos/whatsapp.png",
  keywords: ["whatsapp", "waha", "trigger", "message", "inbound", "webhook"],
  configSchema,
  defaults: { session: "default" },
  inputs: [],
  outputs: [{ id: "main", label: "Out" }],
  credentials: [{ key: "credentialId", type: "waha.apiKey", required: false }],
  docsUrl: "/docs/nodes/WAHA_TRIGGER",
};
