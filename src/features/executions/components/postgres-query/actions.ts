"use server";

import { getSubscriptionToken, type Realtime } from "@inngest/realtime";
import { postgresQueryChannel } from "@/inngest/channels/postgres-query";
import { inngest } from "@/inngest/client";

export type PostgresQueryToken = Realtime.Token<
  typeof postgresQueryChannel,
  ["status"]
>;

export async function fetchPostgresQueryRealtimeToken(): Promise<PostgresQueryToken> {
  const token = await getSubscriptionToken(inngest, {
    channel: postgresQueryChannel(),
    topics: ["status"],
  });

  return token;
}
