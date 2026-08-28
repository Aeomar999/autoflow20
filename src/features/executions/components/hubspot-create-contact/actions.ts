"use server";

import { getSubscriptionToken, type Realtime } from "@inngest/realtime";
import { hubspotCreateContactChannel } from "@/inngest/channels/hubspot-create-contact";
import { inngest } from "@/inngest/client";

export type HubSpotCreateContactToken = Realtime.Token<
  typeof hubspotCreateContactChannel,
  ["status"]
>;

export async function fetchHubSpotCreateContactRealtimeToken(): Promise<HubSpotCreateContactToken> {
  const token = await getSubscriptionToken(inngest, {
    channel: hubspotCreateContactChannel(),
    topics: ["status"],
  });
  return token;
}
