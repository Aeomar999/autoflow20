import { channel, topic } from "@inngest/realtime";

export const WEBHOOK_OUT_CHANNEL_NAME = "webhook-out-execution";

export const webhookOutChannel = channel(WEBHOOK_OUT_CHANNEL_NAME).addTopic(
  topic("status").type<{
    nodeId: string;
    status: "loading" | "success" | "error";
  }>(),
);
