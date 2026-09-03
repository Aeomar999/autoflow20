import type { NodeDefinition } from "@/nodes/types";
import { triggerDataSchema } from "../../shared/config-fields";

/**
 * Webhook trigger.
 *
 * The node itself is intentionally configuration-free and passes its context
 * through: the receiver is the route (`/api/webhooks/[workflowId]/[path]`),
 * which verifies the secret, enforces the rate limit, and puts the request on
 * the run as `initialData.webhook.{path,method,headers,query,body}`. The URL
 * derives from the workflow id, so there is nothing here for a user to set.
 *
 * (The "stub — full implementation in M4" note this carried was left behind
 * when M4 shipped the receiver. It was user-visible in the palette and the
 * node reference, describing a working node as unfinished. Removed AF-M9-16.)
 */
export const configSchema = triggerDataSchema;

export const definition: NodeDefinition = {
  type: "WEBHOOK_TRIGGER",
  version: 1,
  category: "TRIGGER",
  label: "Webhook Trigger",
  description:
    "Start the workflow when an HTTP request arrives at this workflow's webhook URL. Accepts GET, POST, PUT, PATCH and DELETE; add a Respond to Webhook node to reply synchronously.",
  icon: "Webhook",
  keywords: ["webhook", "http", "trigger", "callback"],
  configSchema,
  defaults: {},
  inputs: [],
  outputs: [{ id: "main", label: "Out" }],
};
