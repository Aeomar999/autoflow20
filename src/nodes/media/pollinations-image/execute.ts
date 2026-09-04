import "server-only";
import { NonRetriableError } from "inngest";
import { storeFile } from "@/features/files/server/file-service";
import { generatePollinationsImage } from "@/features/media/server/image-clients";
import { WORKFLOW_USAGE_KEY } from "@/inngest/trace";
import { estimateMediaCostUsd } from "@/lib/ai/registry";
import type { NodeRun } from "@/nodes/types";

type PollinationsData = {
  variableName?: string;
  prompt?: string;
  width?: number;
  height?: number;
  seed?: number;
  model?: string;
  filename?: string;
};

export const execute: NodeRun<PollinationsData> = async ({
  data,
  context,
  resolve,
  step,
  organizationId,
  executionId,
  workflowId,
}) =>
  step.run("pollinations-image", async () => {
    if (!data.variableName) {
      throw new NonRetriableError(
        "Pollinations node: Variable name not configured",
      );
    }
    if (!data.prompt) {
      throw new NonRetriableError("Pollinations node: Prompt not configured");
    }
    if (!organizationId) {
      throw new NonRetriableError(
        "Pollinations node: this run has no organization, so a file cannot be stored for it.",
      );
    }

    const where = "Pollinations node";
    const prompt = resolve(data.prompt).trim();

    if (prompt.length === 0) {
      throw new NonRetriableError(`${where}: the prompt resolved to nothing.`);
    }

    const image = await generatePollinationsImage({
      prompt,
      width: data.width ?? 1024,
      height: data.height ?? 1024,
      seed: data.seed,
      model: data.model?.trim() || undefined,
      where,
    });

    const file = await storeFile({
      organizationId,
      executionId,
      workflowId,
      filename: data.filename ? resolve(data.filename).trim() : "generated.jpg",
      mimeType: image.mimeType,
      data: image.data,
    });

    return {
      ...context,
      [data.variableName]: {
        file,
        prompt,
        width: data.width ?? 1024,
        height: data.height ?? 1024,
        // Present only when one was set. A run that reproduced an image should
        // be able to show how.
        seed: data.seed ?? null,
        bytes: image.data.byteLength,
      },
      // Zero, and recorded anyway: a workflow's cost report should say a step
      // was free rather than say nothing about it.
      [WORKFLOW_USAGE_KEY]: {
        tokensIn: 0,
        tokensOut: 0,
        costUsd: estimateMediaCostUsd("pollinations:flux", 1),
        model: "pollinations:flux",
      },
    };
  });
