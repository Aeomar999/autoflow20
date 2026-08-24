import { NonRetriableError } from "inngest";
import ky, { type Options as KyOptions } from "ky";
import { compileTemplate } from "@/features/executions/template";
import type { NodeExecutor } from "@/features/executions/types";
import { httpRequestChannel } from "@/inngest/channels/http-request";
import {
  assertSafeEndpoint,
  readCappedText,
  resolveTimeoutMs,
} from "./egress-guard";

type HttpRequestData = {
  variableName?: string;
  endpoint?: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: string;
  /** Optional per-node request timeout; clamped by egress-guard. */
  timeoutMs?: number;
};

export const httpRequestExecutor: NodeExecutor<HttpRequestData> = async ({
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
      const method = data.method;

      const options: KyOptions = {
        method,
        timeout: resolveTimeoutMs(data.timeoutMs),
      };

      if (["POST", "PUT", "PATCH"].includes(method)) {
        const resolved = compileTemplate(data.body || "{}")(context);
        JSON.parse(resolved);
        options.body = resolved;
        options.headers = {
          "Content-Type": "application/json",
        };
      }

      const response = await ky(url, options);
      const contentType = response.headers.get("content-type");
      // Body is read through the byte cap before any parse.
      const rawBody = await readCappedText(response);
      const responseData = contentType?.includes("application/json")
        ? JSON.parse(rawBody)
        : rawBody;

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
