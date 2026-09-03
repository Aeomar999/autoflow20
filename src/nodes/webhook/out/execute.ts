import "server-only";
import { NonRetriableError } from "inngest";
import ky, { type Options as KyOptions } from "ky";
import {
  assertSafeEndpoint,
  readCappedText,
  resolveTimeoutMs,
  safeFetch,
} from "@/features/executions/components/http-request/egress-guard";
import { webhookOutChannel } from "@/inngest/channels/webhook-out";
import type { NodeRun } from "@/nodes/types";

type WebhookOutData = {
  variableName?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  failOnNon2xx?: boolean;
};

export const execute: NodeRun<WebhookOutData> = async ({
  data,
  nodeId,
  context,
  resolve,
  step,
  publish,
}) => {
  await publish(
    webhookOutChannel().status({
      nodeId,
      status: "loading",
    }),
  );

  try {
    const result = await step.run("webhook-out", async () => {
      if (!data.url) {
        await publish(
          webhookOutChannel().status({
            nodeId,
            status: "error",
          }),
        );
        throw new NonRetriableError("Webhook node: No URL configured");
      }

      if (!data.variableName) {
        await publish(
          webhookOutChannel().status({
            nodeId,
            status: "error",
          }),
        );
        throw new NonRetriableError(
          "Webhook node: Variable name not configured",
        );
      }

      const endpoint = resolve(data.url);
      const url = await assertSafeEndpoint(endpoint);

      const options: KyOptions = {
        method: "POST",
        timeout: resolveTimeoutMs(data.timeoutMs),
      };

      // Resolve and attach headers.
      if (data.headers) {
        const resolvedHeaders: Record<string, string> = {};
        for (const [key, value] of Object.entries(data.headers)) {
          resolvedHeaders[key] = resolve(value);
        }
        options.headers = resolvedHeaders;
      }

      // Body must be valid JSON after templating — a malformed template is a
      // config error, so it fails non-retriably instead of burning retries.
      const resolvedBody = resolve(data.body || "{}");
      try {
        JSON.parse(resolvedBody);
      } catch {
        await publish(
          webhookOutChannel().status({
            nodeId,
            status: "error",
          }),
        );
        throw new NonRetriableError(
          "Webhook node: request body must be valid JSON after templating",
        );
      }
      options.body = resolvedBody;
      if (!data.headers?.["Content-Type"]) {
        options.headers = {
          ...(options.headers as Record<string, string>),
          "Content-Type": "application/json",
        };
      }

      const response = await ky(url, { ...options, fetch: safeFetch });
      const contentType = response.headers.get("content-type");
      // Body is read through the byte cap before any parse.
      const rawBody = await readCappedText(response);
      const responseData = contentType?.includes("application/json")
        ? JSON.parse(rawBody)
        : rawBody;

      // Non-2xx handling: throw when failOnNon2xx is set.
      if (
        data.failOnNon2xx &&
        (response.status < 200 || response.status >= 300)
      ) {
        throw new NonRetriableError(
          `Webhook node: received status ${response.status} ${response.statusText}`,
        );
      }

      const responsePayload = {
        webhookResponse: {
          status: response.status,
          statusText: response.statusText,
          data: responseData,
        },
      };

      return {
        ...context,
        [data.variableName]: responsePayload,
      };
    });

    await publish(
      webhookOutChannel().status({
        nodeId,
        status: "success",
      }),
    );

    return result;
  } catch (error) {
    await publish(
      webhookOutChannel().status({
        nodeId,
        status: "error",
      }),
    );
    throw error;
  }
};
