import "server-only";
import { NonRetriableError } from "inngest";
import { storeFile } from "@/features/files/server/file-service";
import { generateOpenAiImage } from "@/features/media/server/image-clients";
import { WORKFLOW_USAGE_KEY } from "@/inngest/trace";
import { estimateMediaCostUsd } from "@/lib/ai/registry";
import type { NodeRun } from "@/nodes/types";

type OpenAiImageData = {
  variableName?: string;
  credentialId?: string;
  prompt?: string;
  model?: "gpt-image-1" | "dall-e-3";
  size?: string;
  quality?: string;
  filename?: string;
};

export const execute: NodeRun<OpenAiImageData> = async ({
  data,
  context,
  resolve,
  step,
  credentials,
  organizationId,
  executionId,
  workflowId,
}) =>
  step.run("openai-image", async () => {
    if (!data.variableName) {
      throw new NonRetriableError(
        "OpenAI Image node: Variable name not configured",
      );
    }
    if (!data.prompt) {
      throw new NonRetriableError("OpenAI Image node: Prompt not configured");
    }
    if (!organizationId) {
      throw new NonRetriableError(
        "OpenAI Image node: this run has no organization, so a file cannot be stored for it.",
      );
    }

    const where = "OpenAI Image node";
    const prompt = resolve(data.prompt).trim();

    if (prompt.length === 0) {
      // A blank prompt still costs a generation and returns something
      // arbitrary, so it is refused rather than sent.
      throw new NonRetriableError(
        `${where}: the prompt resolved to nothing. Image generation is billed per request, so an empty prompt is refused rather than sent.`,
      );
    }

    const model = data.model ?? "gpt-image-1";

    const image = await generateOpenAiImage({
      secret: credentials?.credentialId,
      model,
      prompt,
      size: data.size ?? "1024x1024",
      quality: data.quality,
      where,
    });

    const file = await storeFile({
      organizationId,
      executionId,
      workflowId,
      filename: data.filename ? resolve(data.filename).trim() : "generated.png",
      mimeType: image.mimeType,
      data: image.data,
    });

    return {
      ...context,
      [data.variableName]: {
        file,
        prompt,
        // dall-e-3 rewrites prompts. Showing what it actually rendered is the
        // difference between "the image is wrong" and "the model changed the
        // brief".
        revisedPrompt: image.revisedPrompt,
        model,
        size: data.size ?? "1024x1024",
        bytes: image.data.byteLength,
      },
      // Recorded through the same pipeline as token spend, so a workflow that
      // generates an image and then summarises it shows one bill.
      [WORKFLOW_USAGE_KEY]: {
        tokensIn: 0,
        tokensOut: 0,
        costUsd: estimateMediaCostUsd(`openai:${model}`, 1),
        model: `openai:${model}`,
      },
    };
  });
