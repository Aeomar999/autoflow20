import { channel, topic } from "@inngest/realtime";

export const AIRTABLE_CREATE_RECORD_CHANNEL_NAME =
  "airtable-create-record-execution";

export const airtableCreateRecordChannel = channel(
  AIRTABLE_CREATE_RECORD_CHANNEL_NAME,
).addTopic(
  topic("status").type<{
    nodeId: string;
    status: "loading" | "success" | "error";
  }>(),
);
