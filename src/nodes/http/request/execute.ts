import "server-only";
import { NonRetriableError } from "inngest";
import ky, { type Options as KyOptions } from "ky";
import {
  assertSafeEndpoint,
  readCappedText,
  resolveTimeoutMs,
  safeFetch,
} from "@/features/executions/components/http-request/egress-guard";
import { compileTemplate } from "@/features/executions/template";
import { httpRequestChannel } from "@/inngest/channels/http-request";
import type { NodeRun } from "@/nodes/types";

type HttpRequestData = {
  variableName?: string;
  endpoint?: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: string;
  headers?: Record<string, string>;
  queryParams?: Record<string, string>;
  timeoutMs?: number;
  failOnNon2xx?: boolean;
};

export const execute: NodeRun<HttpRequestData> = async ({
  data,
  nodeId,
  context,
  step,
  publish,
}) => {
  await publish(
    httpRequestChannel().status({
      nodeId,
      status: "loading",
    }),
  );

  try {
    const result = await step.run("http-request", async () => {
      if (!data.endpoint) {
        await publish(
          httpRequestChannel().status({
            nodeId,
            status: "error",
          }),
        );
        throw new NonRetriableError(
          "HTTP Request node: No endpoint configured",
        );
      }

      if (!data.variableName) {
        await publish(
          httpRequestChannel().status({
            nodeId,
            status: "error",
          }),
        );
        throw new NonRetriableError(
          "HTTP Request node: Variable name not configured",
        );
      }

      if (!data.method) {
        await publish(
          httpRequestChannel().status({
            nodeId,
            status: "error",
          }),
        );
        throw new NonRetriableError("HTTP Request node: Method not configured");
      }

      const endpoint = compileTemplate(data.endpoint)(context);
      const url = await assertSafeEndpoint(endpoint);

      // Append query parameters (template-resolved).
      if (data.queryParams) {
        for (const [key, value] of Object.entries(data.queryParams)) {
          url.searchParams.set(key, compileTemplate(value)(context));
        }
      }

      const method = data.method;

      const options: KyOptions = {
        method,
        timeout: resolveTimeoutMs(data.timeoutMs),
      };

      // Resolve and attach headers.
      if (data.headers) {
        const resolvedHeaders: Record<string, string> = {};
        for (const [key, value] of Object.entries(data.headers)) {
          resolvedHeaders[key] = compileTemplate(value)(context);
        }
        options.headers = resolvedHeaders;
      }

      if (["POST", "PUT", "PATCH"].includes(method)) {
        const resolved = compileTemplate(data.body || "{}")(context);
        JSON.parse(resolved);
        options.body = resolved;
        // Set Content-Type only if the user hasn't provided it via headers.
        if (!data.headers?.["Content-Type"]) {
          options.headers = {
            ...(options.headers as Record<string, string>),
            "Content-Type": "application/json",
          };
        }
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
          `HTTP Request node: received status ${response.status} ${response.statusText}`,
        );
      }

      const responsePayload = {
        httpResponse: {
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
      httpRequestChannel().status({
        nodeId,
        status: "success",
      }),
    );

    return result;
  } catch (error) {
    await publish(
      httpRequestChannel().status({
        nodeId,
        status: "error",
      }),
    );
    throw error;
  }
};
