"use server";

import { getSubscriptionToken, type Realtime } from "@inngest/realtime";
import { openAiCompatibleChatChannel } from "@/inngest/channels/openai-compatible-chat";
import { inngest } from "@/inngest/client";

export type OpenAiCompatibleChatToken = Realtime.Token<
  typeof openAiCompatibleChatChannel,
  ["status"]
>;

export async function fetchOpenAiCompatibleChatRealtimeToken(): Promise<OpenAiCompatibleChatToken> {
  const token = await getSubscriptionToken(inngest, {
    channel: openAiCompatibleChatChannel(),
    topics: ["status"],
  });

  return token;
}
