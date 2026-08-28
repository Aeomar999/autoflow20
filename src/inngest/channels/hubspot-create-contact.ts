import { channel, topic } from "@inngest/realtime";

export const HUBSPOT_CREATE_CONTACT_CHANNEL_NAME =
  "hubspot-create-contact-execution";

export const hubspotCreateContactChannel = channel(
  HUBSPOT_CREATE_CONTACT_CHANNEL_NAME,
).addTopic(
  topic("status").type<{
    nodeId: string;
    status: "loading" | "success" | "error";
  }>(),
);
