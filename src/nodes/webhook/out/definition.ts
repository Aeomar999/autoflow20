import { z } from "zod";
import type { NodeDefinition } from "@/nodes/types";
import { urlTemplate, variableNameSchema } from "../../shared/config-fields";

export const configSchema = z.object({
  /** Result key in the run context: {{variableName.webhookResponse.status}} */
  variableName: variableNameSchema.optional(),
  /** Webhook endpoint. Supports Handlebars templates; SSRF-checked at run time. */
  url: urlTemplate(2048).optional(),
  /** JSON object of request headers. Keys and values support templates. */
  headers: z.record(z.string(), z.string()).optional(),
  /** JSON string request body. Supports Handlebars templates. Defaults to {}. */
  body: z.string().max(65_536).optional(),
  /** Optional per-node request timeout; clamped by egress-guard. */
  timeoutMs: z.number().int().min(250).max(60_000).optional(),
  /**
   * When true, non-2xx responses throw instead of being stored as data.
   * Default: false (the response is stored regardless of status).
   */
  failOnNon2xx: z.boolean().optional(),
});

export const definition: NodeDefinition = {
  type: "WEBHOOK_OUT",
  version: 1,
  category: "ACTION",
  label: "Webhook",
  description:
    "Send a templated POST request to a webhook URL and store the delivery response.",
  icon: "Webhook",
  keywords: ["webhook", "notify", "callback", "integration", "outbound"],
  configSchema,
  defaults: {},
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
};
