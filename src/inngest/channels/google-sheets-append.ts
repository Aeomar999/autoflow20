import { channel, topic } from "@inngest/realtime";

export const GOOGLE_SHEETS_APPEND_CHANNEL_NAME =
  "google-sheets-append-execution";

export const googleSheetsAppendChannel = channel(
  GOOGLE_SHEETS_APPEND_CHANNEL_NAME,
).addTopic(
  topic("status").type<{
    nodeId: string;
    status: "loading" | "success" | "error";
  }>(),
);
