import type { NodeDefinition } from "@/nodes/types";
import { triggerDataSchema } from "../../shared/config-fields";

/**
 * Webhook trigger stub (pending M4). When invoked, passes through
 * the context unchanged. Full webhook receiver lands with M4.
 */
export const configSchema = triggerDataSchema;

export const definition: NodeDefinition = {
  type: "WEBHOOK_TRIGGER",
  version: 1,
  category: "TRIGGER",
  label: "Webhook Trigger",
  description:
    "Start the workflow when a webhook is received. (Stub — full implementation in M4.)",
  icon: "Webhook",
  keywords: ["webhook", "http", "trigger", "callback"],
  configSchema,
  defaults: {},
  inputs: [],
  outputs: [{ id: "main", label: "Out" }],
};
