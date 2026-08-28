import "server-only";
import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { NonRetriableError } from "inngest";
import { compileTemplate } from "@/features/executions/template";
import { anthropicChannel } from "@/inngest/channels/anthropic";
import type { NodeRun } from "@/nodes/types";

type AnthropicData = {
  variableName?: string;
  credentialId?: string;
  systemPrompt?: string;
  userPrompt?: string;
};

export const execute: NodeRun<AnthropicData> = async ({
  data,
  nodeId,
  context,
  step,
  publish,
  credentials,
}) => {
  await publish(
    anthropicChannel().status({
      nodeId,
      status: "loading",
    }),
  );

  if (!data.variableName) {
    await publish(
      anthropicChannel().status({
        nodeId,
        status: "error",
      }),
    );
    throw new NonRetriableError("Anthropic node: Variable name is missing");
  }

  if (!data.credentialId) {
    await publish(
      anthropicChannel().status({
        nodeId,
        status: "error",
      }),
    );
    throw new NonRetriableError("Anthropic node: Credential is required");
  }

  if (!data.userPrompt) {
    await publish(
      anthropicChannel().status({
        nodeId,
        status: "error",
      }),
    );
    throw new NonRetriableError("Anthropic node: User prompt is missing");
  }

  const secret = credentials?.credentialId;
  if (!secret) {
    await publish(
      anthropicChannel().status({
        nodeId,
        status: "error",
      }),
    );
    throw new NonRetriableError("Anthropic node: Credential not found");
  }

  const systemPrompt = data.systemPrompt
    ? compileTemplate(data.systemPrompt)(context)
    : "You are a helpful assistant.";
  const userPrompt = compileTemplate(data.userPrompt)(context);

  const anthropic = createAnthropic({
    apiKey: secret.apiKey,
  });

  try {
    const { steps } = await step.ai.wrap(
      "anthropic-generate-text",
      generateText,
      {
        model: anthropic("claude-sonnet-4-5"),
        system: systemPrompt,
        prompt: userPrompt,
        experimental_telemetry: {
          isEnabled: true,
          recordInputs: true,
          recordOutputs: true,
        },
      },
    );

    const text =
      steps[0].content[0].type === "text" ? steps[0].content[0].text : "";

    await publish(
      anthropicChannel().status({
        nodeId,
        status: "success",
      }),
    );

    return {
      ...context,
      [data.variableName]: {
        text,
      },
    };
  } catch (error) {
    await publish(
      anthropicChannel().status({
        nodeId,
        status: "error",
      }),
    );
    throw error;
  }
};
