import { channel, topic } from "@inngest/realtime";

export const POSTGRES_QUERY_CHANNEL_NAME = "postgres-query-execution";

export const postgresQueryChannel = channel(
  POSTGRES_QUERY_CHANNEL_NAME,
).addTopic(
  topic("status").type<{
    nodeId: string;
    status: "loading" | "success" | "error";
  }>(),
);
