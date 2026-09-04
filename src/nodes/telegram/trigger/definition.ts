import { z } from "zod";
import {
  TELEGRAM_CREDENTIAL_TYPE,
  TELEGRAM_LOGO,
} from "@/features/telegram/constants";
import type { NodeDefinition } from "@/nodes/types";
import { credentialIdRef, freeText } from "../../shared/config-fields";

export const configSchema = z.object({
  credentialId: credentialIdRef().optional(),
  /** Only messages beginning with this, e.g. `/report`. Blank means all. */
  commandFilter: freeText(64).optional(),
  /** Comma-separated chat ids. Blank accepts any chat the bot is in. */
  allowedChatIds: freeText(1024).optional(),
});

export const definition: NodeDefinition = {
  type: "TELEGRAM_TRIGGER",
  version: 1,
  category: "TRIGGER",
  label: "Telegram Trigger",
  description:
    "Start a workflow when someone messages the bot. Deliveries are dropped unless they carry the workflow's own secret token, which Telegram echoes from setWebhook.",
  icon: "MessageCircle",
  logo: TELEGRAM_LOGO,
  keywords: ["telegram", "trigger", "message", "bot", "webhook", "chat"],
  configSchema,
  defaults: {},
  inputs: [],
  outputs: [{ id: "main", label: "Out" }],
  credentials: [
    { key: "credentialId", type: TELEGRAM_CREDENTIAL_TYPE, required: false },
  ],
  docsUrl: "/docs/nodes/TELEGRAM_TRIGGER",
};
