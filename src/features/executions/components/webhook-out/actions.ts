"use server";

import { getSubscriptionToken, type Realtime } from "@inngest/realtime";
import { webhookOutChannel } from "@/inngest/channels/webhook-out";
import { inngest } from "@/inngest/client";

export type WebhookOutToken = Realtime.Token<
  typeof webhookOutChannel,
  ["status"]
>;

export async function fetchWebhookOutRealtimeToken(): Promise<WebhookOutToken> {
  const token = await getSubscriptionToken(inngest, {
    channel: webhookOutChannel(),
    topics: ["status"],
  });

  return token;
}
