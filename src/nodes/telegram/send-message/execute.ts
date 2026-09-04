import "server-only";
import { NonRetriableError } from "inngest";
import { TELEGRAM_MAX_MESSAGE_CHARS } from "@/features/telegram/constants";
import {
  splitMessage,
  type TelegramMessage,
  telegramFetch,
} from "@/features/telegram/server/telegram-client";
import type { NodeRun } from "@/nodes/types";

type TelegramSendData = {
  variableName?: string;
  credentialId?: string;
  chatId?: string;
  text?: string;
  parseMode?: "MarkdownV2" | "HTML" | "plain";
  silent?: boolean;
  disableLinkPreview?: boolean;
};

export const execute: NodeRun<TelegramSendData> = async ({
  data,
  context,
  resolve,
  step,
  credentials,
}) =>
  step.run("telegram-send-message", async () => {
    if (!data.variableName) {
      throw new NonRetriableError(
        "Telegram Send node: Variable name not configured",
      );
    }
    if (!data.chatId) {
      throw new NonRetriableError("Telegram Send node: Chat not configured");
    }
    if (!data.text) {
      throw new NonRetriableError("Telegram Send node: Text not configured");
    }

    const where = "Telegram Send node";
    const secret = credentials?.credentialId;
    const chatId = resolve(data.chatId).trim();
    const text = resolve(data.text);

    if (text.trim().length === 0) {
      // Telegram rejects an empty message with a 400 that says
      // "message text is empty", which is true but unhelpful about why.
      throw new NonRetriableError(
        `${where}: the text expression resolved to nothing.`,
      );
    }

    // Telegram REJECTS an over-long message rather than truncating it, so the
    // alternative to splitting is losing the whole thing.
    const chunks = splitMessage(text, TELEGRAM_MAX_MESSAGE_CHARS);
    const sent: TelegramMessage[] = [];

    for (const chunk of chunks) {
      const message = await telegramFetch<TelegramMessage>(secret, {
        method: "sendMessage",
        body: {
          chat_id: chatId,
          text: chunk,
          // "plain" means send no parse_mode at all: passing an empty string
          // is a 400, and passing Markdown to text that was never escaped for
          // it is the most common way a Telegram message fails to send.
          ...(data.parseMode && data.parseMode !== "plain"
            ? { parse_mode: data.parseMode }
            : {}),
          ...(data.silent ? { disable_notification: true } : {}),
          ...(data.disableLinkPreview
            ? { link_preview_options: { is_disabled: true } }
            : {}),
        },
        where,
      });
      sent.push(message);
    }

    const first = sent[0];

    return {
      ...context,
      [data.variableName]: {
        chatId,
        messageId: first?.message_id ?? null,
        // More than one when the text had to be split. Surfaced so a workflow
        // that replies in-thread knows which id to use.
        messageIds: sent.map((message) => message.message_id),
        parts: sent.length,
      },
    };
  });
