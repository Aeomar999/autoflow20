import "server-only";
import { NonRetriableError } from "inngest";
import { manualTriggerChannel } from "@/inngest/channels/manual-trigger";
import {
  MAX_WEBHOOK_RESPONSE_BYTES,
  WEBHOOK_RESPONSE_KEY,
} from "@/inngest/trace";
import {
  filterResponseHeaders,
  isValidResponseStatus,
} from "@/lib/webhook-response";
import type { NodeRun } from "@/nodes/types";

type RespondToWebhookData = {
  statusCode?: number;
  contentType?: string;
  body?: string;
  headers?: Record<string, string>;
};

const DEFAULT_STATUS = 200;
const DEFAULT_CONTENT_TYPE = "application/json";

/**
 * Compose the synchronous webhook response (AF-M9-10).
 *
 * The node does not touch the database and does not know the execution id:
 * it attaches the composed response to the returned context under
 * `WEBHOOK_RESPONSE_KEY`, and the engine harvests it at the node boundary.
 * That keeps the executor pure and testable, and matches how `_outputPort`
 * and `__usage` already cross the same boundary.
 *
 * The context passes through otherwise unchanged, so a respond node is
 * transparent to everything downstream of it.
 */
export const execute: NodeRun<RespondToWebhookData> = async ({
  data,
  nodeId,
  context,
  resolve,
  step,
  publish,
}) => {
  await publish(manualTriggerChannel().status({ nodeId, status: "loading" }));

  try {
    const result = await step.run("respond-to-webhook", async () => {
      const statusCode = data.statusCode ?? DEFAULT_STATUS;
      if (!isValidResponseStatus(statusCode)) {
        throw new NonRetriableError(
          `Respond to Webhook node: status code ${statusCode} is not a valid response status (200-599)`,
        );
      }

      const contentType = resolve(data.contentType ?? DEFAULT_CONTENT_TYPE);
      const body = resolve(data.body ?? "");

      // Reject rather than truncate: a caller that receives half a JSON
      // document gets a parse error it cannot attribute, which is strictly
      // worse than a run that fails and says why (ADR-0018's posture).
      const bodyBytes = Buffer.byteLength(body, "utf8");
      if (bodyBytes > MAX_WEBHOOK_RESPONSE_BYTES) {
        throw new NonRetriableError(
          `Respond to Webhook node: response body is ${bodyBytes} bytes, exceeding the ${MAX_WEBHOOK_RESPONSE_BYTES}-byte limit. Return a summary or a URL instead of the full payload.`,
        );
      }

      // Header names and values are both templated, then filtered. Filtering
      // AFTER resolution is the point: a template could otherwise resolve to
      // `Set-Cookie` or smuggle a CRLF through a value.
      const resolvedHeaders: Record<string, string> = {};
      for (const [name, value] of Object.entries(data.headers ?? {})) {
        resolvedHeaders[resolve(name)] = resolve(value);
      }

      const { headers, rejected } = filterResponseHeaders(resolvedHeaders);
      if (rejected.length > 0) {
        // A dropped header is a config error the author can fix, and silently
        // dropping it would make the endpoint behave differently from what
        // the canvas shows. Fail loudly at compose time instead.
        throw new NonRetriableError(
          `Respond to Webhook node: these response headers are not permitted: ${rejected.join(", ")}. Set-Cookie, hop-by-hop headers, Content-Length and Content-Type are reserved; use the Content Type field, or prefix a custom header with "x-".`,
        );
      }

      return {
        ...context,
        [WEBHOOK_RESPONSE_KEY]: {
          statusCode,
          contentType,
          headers,
          body,
        },
      };
    });

    await publish(manualTriggerChannel().status({ nodeId, status: "success" }));
    return result;
  } catch (error) {
    await publish(manualTriggerChannel().status({ nodeId, status: "error" }));
    throw error;
  }
};
