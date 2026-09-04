import { z } from "zod";
import {
  TELEGRAM_CREDENTIAL_TYPE,
  TELEGRAM_LOGO,
  TELEGRAM_PARSE_MODES,
} from "@/features/telegram/constants";
import type { NodeDefinition } from "@/nodes/types";
import {
  credentialIdRef,
  freeText,
  variableNameSchema,
} from "../../shared/config-fields";

export const configSchema = z.object({
  variableName: variableNameSchema.optional(),
  credentialId: credentialIdRef(),
  /** Numeric chat id, or @channelusername for a public channel. */
  chatId: freeText(128).optional(),
  text: freeText(64_000).optional(),
  parseMode: z.enum(TELEGRAM_PARSE_MODES).optional(),
  /** Send without the notification sound. */
  silent: z.boolean().optional(),
  disableLinkPreview: z.boolean().optional(),
});

export const definition: NodeDefinition = {
  type: "TELEGRAM_SEND_MESSAGE",
  version: 1,
  category: "ACTION",
  label: "Telegram Send Message",
  description:
    "Send a message to a chat, channel or group. Text over Telegram's 4096-character limit is split on a line boundary rather than rejected.",
  icon: "Send",
  logo: TELEGRAM_LOGO,
  keywords: ["telegram", "message", "send", "chat", "bot", "notify"],
  configSchema,
  defaults: { parseMode: "plain", silent: false, disableLinkPreview: false },
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  credentials: [
    { key: "credentialId", type: TELEGRAM_CREDENTIAL_TYPE, required: true },
  ],
  docsUrl: "/docs/nodes/TELEGRAM_SEND_MESSAGE",
};
