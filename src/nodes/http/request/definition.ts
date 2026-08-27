import { z } from "zod";
import type { NodeDefinition } from "@/nodes/types";
import { urlTemplate, variableNameSchema } from "../../shared/config-fields";

export const configSchema = z.object({
  /** Result key in the run context: {{variableName.httpResponse.data}} */
  variableName: variableNameSchema.optional(),
  endpoint: urlTemplate(2048).optional(),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).optional(),
  /** JSON string body for POST/PUT/PATCH. Supports Handlebars templates. */
  body: z.string().max(65_536).optional(),
  /** JSON object of request headers. Keys and values support templates. */
  headers: z.record(z.string(), z.string()).optional(),
  /** URL query parameters as key-value pairs. Values support templates. */
  queryParams: z.record(z.string(), z.string()).optional(),
  /** Optional per-node request timeout; clamped by egress-guard. */
  timeoutMs: z.number().int().min(250).max(60_000).optional(),
  /**
   * When true, non-2xx responses throw instead of being stored as data.
   * Default: false (response is stored regardless of status).
   */
  failOnNon2xx: z.boolean().optional(),
});

export const definition: NodeDefinition = {
  type: "HTTP_REQUEST",
  version: 1,
  category: "ACTION",
  label: "HTTP Request",
  description:
    "Call any HTTP endpoint and store the response. URLs support templates.",
  icon: "Globe",
  keywords: ["http", "api", "rest", "fetch", "request"],
  configSchema,
  defaults: {},
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
};
