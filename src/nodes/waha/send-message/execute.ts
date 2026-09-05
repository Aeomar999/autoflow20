import "server-only";
import { NonRetriableError } from "inngest";
import {
  normalizeChatId,
  type WahaMessage,
  wahaFetch,
} from "@/features/waha/server/waha-client";
import type { NodeRun } from "@/nodes/types";

type WahaSendData = {
  variableName?: string;
  credentialId?: string;
  chatId?: string;
  text?: string;
  session?: string;
};

export const execute: NodeRun<WahaSendData> = async ({
  data,
  context,
  resolve,
  step,
  credentials,
}) =>
  step.run("waha-send-message", async () => {
    if (!data.variableName) {
      throw new NonRetriableError(
        "WhatsApp Send node: Variable name not configured",
      );
    }
    if (!data.chatId) {
      throw new NonRetriableError("WhatsApp Send node: Chat not configured");
    }
    if (!data.text) {
      throw new NonRetriableError("WhatsApp Send node: Text not configured");
    }

    const where = "WhatsApp Send node";
    const text = resolve(data.text);

    if (text.trim().length === 0) {
      throw new NonRetriableError(
        `${where}: the text expression resolved to nothing.`,
      );
    }

    // A raw phone number is accepted by WAHA and delivered nowhere, so the
    // normalisation is the difference between working and silently not.
    const chatId = normalizeChatId(resolve(data.chatId));

    const sent = await wahaFetch<WahaMessage>(credentials?.credentialId, {
      path: "/api/sendText",
      method: "POST",
      body: {
        chatId,
        text,
        session: data.session?.trim() || "default",
      },
      where,
    });

    return {
      ...context,
      [data.variableName]: {
        chatId,
        messageId: sent?.id ?? null,
        session: data.session?.trim() || "default",
      },
    };
  });
