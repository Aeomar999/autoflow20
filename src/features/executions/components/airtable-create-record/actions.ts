"use server";

import { getSubscriptionToken, type Realtime } from "@inngest/realtime";
import { airtableCreateRecordChannel } from "@/inngest/channels/airtable-create-record";
import { inngest } from "@/inngest/client";

export type AirtableCreateRecordToken = Realtime.Token<
  typeof airtableCreateRecordChannel,
  ["status"]
>;

export async function fetchAirtableCreateRecordRealtimeToken(): Promise<AirtableCreateRecordToken> {
  const token = await getSubscriptionToken(inngest, {
    channel: airtableCreateRecordChannel(),
    topics: ["status"],
  });
  return token;
}
