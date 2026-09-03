import { z } from "zod";
import type { NodeDefinition } from "@/nodes/types";
import { freeText } from "../../shared/config-fields";

/**
 * `RESPOND_TO_WEBHOOK` (AF-M9-10, G3).
 *
 * Before this node, a `?sync=true` webhook call always received the fixed
 * envelope `{success, executionId, error}` — the workflow's own output never
 * reached the caller, and there was no way to choose a status code or a
 * content type. That makes every "sync API endpoint" shape in the reference
 * library (W1) inexpressible.
 *
 * The node composes a response and hands it to the engine, which persists it
 * on `Execution.response`; the webhook route returns it verbatim. Reaching
 * this node does NOT end the run — downstream nodes still execute. That
 * matches n8n's "Respond to Webhook" and keeps the common shape (respond
 * early, then do slow follow-up work) available.
 */
export const configSchema = z.object({
  /**
   * 200-599. The 1xx range is excluded: an informational status is an interim
   * response with no body, which a settled execution cannot express.
   */
  statusCode: z.number().int().min(200).max(599).optional(),
  contentType: z.string().max(128).optional(),
  /** Handlebars template; capped at the engine's response-body limit. */
  body: freeText(1_000_000).optional(),
  /**
   * Extra response headers. Names and values are templates; both are filtered
   * through the `src/lib/webhook-response.ts` allowlist at compose time AND
   * again at emit time.
   */
  headers: z.record(z.string(), z.string()).optional(),
});

export const definition: NodeDefinition = {
  type: "RESPOND_TO_WEBHOOK",
  version: 1,
  category: "ACTION",
  label: "Respond to Webhook",
  description:
    "Return a response to the caller of a synchronous webhook. Status, content type, headers and body all support templates.",
  icon: "Reply",
  keywords: ["respond", "webhook", "response", "reply", "http", "api", "sync"],
  configSchema,
  defaults: {
    statusCode: 200,
    contentType: "application/json",
    body: "{{{json $json}}}",
  },
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  docsUrl: "/docs/nodes/respond-to-webhook",
};
