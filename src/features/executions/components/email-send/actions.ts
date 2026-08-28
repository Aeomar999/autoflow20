"use server";

import { getSubscriptionToken, type Realtime } from "@inngest/realtime";
import { emailSendChannel } from "@/inngest/channels/email-send";
import { inngest } from "@/inngest/client";

export type EmailSendToken = Realtime.Token<
  typeof emailSendChannel,
  ["status"]
>;

export async function fetchEmailSendRealtimeToken(): Promise<EmailSendToken> {
  const token = await getSubscriptionToken(inngest, {
    channel: emailSendChannel(),
    topics: ["status"],
  });

  return token;
}
