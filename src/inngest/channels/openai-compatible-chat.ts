import { channel, topic } from "@inngest/realtime";

export const OPENAI_COMPATIBLE_CHAT_CHANNEL_NAME =
  "openai-compatible-chat-execution";

export const openAiCompatibleChatChannel = channel(
  OPENAI_COMPATIBLE_CHAT_CHANNEL_NAME,
).addTopic(
  topic("status").type<{
    nodeId: string;
    status: "loading" | "success" | "error";
  }>(),
);
