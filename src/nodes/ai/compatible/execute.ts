import "server-only";
import { NonRetriableError } from "inngest";
import ky from "ky";
import {
  assertSafeEndpoint,
  readCappedText,
  resolveTimeoutMs,
  safeFetch,
} from "@/features/executions/components/http-request/egress-guard";
import { openAiCompatibleChatChannel } from "@/inngest/channels/openai-compatible-chat";
import { WORKFLOW_USAGE_KEY } from "@/inngest/trace";
import type { NodeRun } from "@/nodes/types";

type OpenAiCompatibleData = {
  variableName?: string;
  credentialId?: string;
  baseUrl?: string;
  model?: string;
  systemPrompt?: string;
  userPrompt?: string;
};

const ERROR_PREFIX = "OpenAI-Compatible node";

export const execute: NodeRun<OpenAiCompatibleData> = async ({
  data,
  nodeId,
  context,
  resolve,
  step,
  publish,
  credentials,
}) => {
  await publish(
    openAiCompatibleChatChannel().status({
      nodeId,
      status: "loading",
    }),
  );

  const fail = async (message: string): Promise<never> => {
    await publish(
      openAiCompatibleChatChannel().status({
        nodeId,
        status: "error",
      }),
    );
    throw new NonRetriableError(`${ERROR_PREFIX}: ${message}`);
  };

  try {
    const result = await step.run("openai-compatible-chat", async () => {
      if (!data.variableName) {
        return fail("Variable name not configured");
      }

      const secret = credentials?.credentialId;
      if (!secret?.apiKey) {
        return fail("OpenAI-compatible credential not found");
      }

      if (!data.baseUrl) {
        return fail("Base URL not configured");
      }

      if (!data.model) {
        return fail("Model not configured");
      }

      if (!data.userPrompt) {
        return fail("Prompt not configured");
      }

      // SSRF guard: the rendered base URL must be a safe outbound endpoint
      // before any request is issued.
      const renderedUrl = resolve(data.baseUrl);
      const baseUrl = await assertSafeEndpoint(renderedUrl);

      const messages: Array<{ role: "system" | "user"; content: string }> = [];
      if (data.systemPrompt) {
        messages.push({
          role: "system",
          content: resolve(data.systemPrompt),
        });
      }
      messages.push({
        role: "user",
        content: resolve(data.userPrompt),
      });

      const chatUrl = `${baseUrl.origin}${baseUrl.pathname.replace(/\/+$/, "")}/chat/completions`;

      const response = await ky(chatUrl, {
        method: "POST",
        fetch: safeFetch,
        timeout: resolveTimeoutMs(undefined),
        throwHttpErrors: false,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${secret.apiKey}`,
        },
        json: {
          model: data.model,
          messages,
        },
      });

      const rawBody = await readCappedText(response);

      if (!response.ok) {
        let message = `HTTP ${response.status} ${response.statusText}`;
        try {
          const payload = JSON.parse(rawBody) as {
            error?: { message?: unknown };
          };
          if (typeof payload.error?.message === "string") {
            message = payload.error.message;
          }
        } catch {
          // Non-JSON error body: keep the status-line message.
        }
        return fail(`API error ${response.status}: ${message}`);
      }

      const payload = JSON.parse(rawBody) as {
        id?: unknown;
        model?: unknown;
        choices?: Array<{ message?: { content?: unknown } }>;
        usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
      };

      const text = payload.choices?.[0]?.message?.content;
      if (typeof text !== "string") {
        return fail("response is missing a chat completion");
      }

      const promptTokens =
        typeof payload.usage?.prompt_tokens === "number"
          ? payload.usage.prompt_tokens
          : 0;
      const completionTokens =
        typeof payload.usage?.completion_tokens === "number"
          ? payload.usage.completion_tokens
          : 0;

      return {
        ...context,
        [data.variableName]: {
          id: typeof payload.id === "string" ? payload.id : undefined,
          model: typeof payload.model === "string" ? payload.model : undefined,
          text,
          usage: {
            promptTokens: promptTokens || undefined,
            completionTokens: completionTokens || undefined,
          },
        },
        [WORKFLOW_USAGE_KEY]: {
          tokensIn: promptTokens,
          tokensOut: completionTokens,
          costUsd: 0,
          model: typeof payload.model === "string" ? payload.model : data.model,
        },
      };
    });

    await publish(
      openAiCompatibleChatChannel().status({
        nodeId,
        status: "success",
      }),
    );

    return result;
  } catch (error) {
    await publish(
      openAiCompatibleChatChannel().status({
        nodeId,
        status: "error",
      }),
    );
    throw error;
  }
};
