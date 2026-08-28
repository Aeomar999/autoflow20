import { channel, topic } from "@inngest/realtime";

export const EMAIL_SEND_CHANNEL_NAME = "email-send-execution";

export const emailSendChannel = channel(EMAIL_SEND_CHANNEL_NAME).addTopic(
  topic("status").type<{
    nodeId: string;
    status: "loading" | "success" | "error";
  }>(),
);
