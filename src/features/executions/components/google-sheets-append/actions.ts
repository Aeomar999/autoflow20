"use server";

import { getSubscriptionToken, type Realtime } from "@inngest/realtime";
import { googleSheetsAppendChannel } from "@/inngest/channels/google-sheets-append";
import { inngest } from "@/inngest/client";

export type GoogleSheetsAppendToken = Realtime.Token<
  typeof googleSheetsAppendChannel,
  ["status"]
>;

export async function fetchGoogleSheetsAppendRealtimeToken(): Promise<GoogleSheetsAppendToken> {
  const token = await getSubscriptionToken(inngest, {
    channel: googleSheetsAppendChannel(),
    topics: ["status"],
  });
  return token;
}
