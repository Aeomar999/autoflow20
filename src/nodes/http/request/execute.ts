import "server-only";
import { NonRetriableError } from "inngest";
import ky, { type Options as KyOptions } from "ky";
import {
  assertSafeEndpoint,
  createSafeFetch,
  readCappedText,
  resolveTimeoutMs,
} from "@/features/executions/components/http-request/egress-guard";
import { httpRequestChannel } from "@/inngest/channels/http-request";
import { buildHttpAuth, type HttpAuthMode } from "@/nodes/shared/http-auth";
import { redactSecrets } from "@/nodes/shared/redact";
import type { NodeRun } from "@/nodes/types";

type HttpRequestData = {
  variableName?: string;
  endpoint?: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: string;
  headers?: Record<string, string>;
  queryParams?: Record<string, string>;
  credentialId?: string;
  authMode?: HttpAuthMode;
  authHeaderName?: string;
  authQueryParam?: string;
  timeoutMs?: number;
  failOnNon2xx?: boolean;
};

export const execute: NodeRun<HttpRequestData> = async ({
  data,
  nodeId,
  context,
  resolve,
  step,
  publish,
  credentials,
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

      const endpoint = resolve(data.endpoint);
      const url = await assertSafeEndpoint(endpoint);

      // Append query parameters (template-resolved).
      if (data.queryParams) {
        for (const [key, value] of Object.entries(data.queryParams)) {
          url.searchParams.set(key, resolve(value));
        }
      }

      // AF-M10-01: auth is built from the RESOLVED CREDENTIAL MAP only.
      // `data` is persisted into `NodeExecution.input`, so a secret read from
      // node config would already be in the trace before this line.
      const auth = buildHttpAuth(data.authMode, credentials?.credentialId, {
        headerName: data.authHeaderName
          ? resolve(data.authHeaderName)
          : undefined,
        queryParamName: data.authQueryParam
          ? resolve(data.authQueryParam)
          : undefined,
      });

      for (const [key, value] of Object.entries(auth.query)) {
        url.searchParams.set(key, value);
      }

      const method = data.method;

      const options: KyOptions = {
        method,
        timeout: resolveTimeoutMs(data.timeoutMs),
      };

      // Resolve and attach headers. Auth is applied last so a templated header
      // cannot shadow the credential the user selected — a silent
      // "unauthenticated after all" is worse than an overwritten header.
      const resolvedHeaders: Record<string, string> = {};
      if (data.headers) {
        for (const [key, value] of Object.entries(data.headers)) {
          resolvedHeaders[key] = resolve(value);
        }
      }
      Object.assign(resolvedHeaders, auth.headers);
      options.headers = resolvedHeaders;

      if (["POST", "PUT", "PATCH"].includes(method)) {
        const resolved = resolve(data.body || "{}");
        JSON.parse(resolved);
        options.body = resolved;
        // Set Content-Type only if the user hasn't provided it via headers.
        if (!data.headers?.["Content-Type"]) {
          options.headers = {
            ...resolvedHeaders,
            "Content-Type": "application/json",
          };
        }
      }

      const response = await ky(url, {
        ...options,
        // The guard re-vets every redirect hop AND drops this request's own
        // auth headers when a hop leaves the origin (ADR-0022): a redirect
        // must not be a way to harvest the credential.
        fetch: createSafeFetch({
          credentialHeaders: auth.credentialHeaderNames,
        }),
      });
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
          // An endpoint that echoes the request (debug services, API gateways,
          // the fixture servers this library is tested against) sends the
          // credential straight back. Redacting here is what keeps
          // `NodeExecution.output` free of plaintext.
          data: redactSecrets(responseData, auth.secretValues),
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
