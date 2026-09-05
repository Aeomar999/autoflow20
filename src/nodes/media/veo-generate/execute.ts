import "server-only";
import { NonRetriableError } from "inngest";
import { storeFile } from "@/features/files/server/file-service";
import {
  MEDIA_DEFAULT_WAIT_SECONDS,
  MEDIA_MAX_WAIT_SECONDS,
} from "@/features/media/constants";
import { pollMediaJob } from "@/features/media/server/job-poller";
import {
  pollVeoOperation,
  startVeoGeneration,
  type VeoOperation,
} from "@/features/media/server/video-clients";
import { WORKFLOW_USAGE_KEY } from "@/inngest/trace";
import { estimateMediaCostUsd } from "@/lib/ai/registry";
import type { NodeRun } from "@/nodes/types";

type VeoData = {
  variableName?: string;
  credentialId?: string;
  prompt?: string;
  model?: string;
  durationSeconds?: number;
  aspectRatio?: "16:9" | "9:16";
  maxWaitSeconds?: number;
};

export const execute: NodeRun<VeoData> = async ({
  data,
  nodeId,
  executionId,
  workflowId,
  context,
  resolve,
  step,
  credentials,
  organizationId,
}) => {
  if (!data.variableName) {
    throw new NonRetriableError("Veo node: Variable name not configured");
  }
  if (!data.prompt) {
    throw new NonRetriableError("Veo node: Prompt not configured");
  }
  if (!organizationId) {
    throw new NonRetriableError(
      "Veo node: this run has no organization, so a file cannot be stored for it.",
    );
  }

  const where = "Veo node";
  const secret = credentials?.credentialId;
  const model = data.model?.trim() || "veo-3.0-generate-001";
  const seconds = data.durationSeconds ?? 8;
  const waitSeconds = Math.min(
    data.maxWaitSeconds ?? MEDIA_DEFAULT_WAIT_SECONDS,
    MEDIA_MAX_WAIT_SECONDS,
  );

  // Submitted in its own step so a retry of the wait cannot start a second
  // generation — which would bill twice for a video nobody asked for.
  const operationName = await step.run(`veo-start:${nodeId}`, async () => {
    const prompt = resolve(data.prompt as string).trim();
    if (prompt.length === 0) {
      throw new NonRetriableError(
        `${where}: the prompt resolved to nothing. Video generation is billed per second of output, so an empty prompt is refused rather than sent.`,
      );
    }

    return startVeoGeneration({
      secret,
      model,
      prompt,
      durationSeconds: seconds,
      aspectRatio: data.aspectRatio ?? "16:9",
      where,
    });
  });

  const operation = await pollMediaJob<VeoOperation>({
    step,
    nodeId,
    executionId,
    maxWaitSeconds: waitSeconds,
    where,
    jobLabel: "video generation",
    poll: async () => pollVeoOperation({ secret, model, operationName, where }),
  });

  const video = operation.response?.videos?.[0];
  if (!video?.bytesBase64Encoded) {
    // Veo can be asked to write to a GCS bucket instead of returning bytes.
    // This node does not take a bucket, so bytes are what it expects — saying
    // so beats a null-pointer further down.
    throw new NonRetriableError(
      `${where}: the generation finished but returned no video bytes. This node reads inline output; a request configured to write to a Cloud Storage bucket is not supported.`,
    );
  }

  const file = await step.run(`veo-store:${nodeId}`, async () =>
    storeFile({
      organizationId,
      executionId,
      workflowId,
      filename: "veo.mp4",
      mimeType: "video/mp4",
      data: Buffer.from(video.bytesBase64Encoded as string, "base64"),
    }),
  );

  return {
    ...context,
    [data.variableName as string]: {
      file,
      model,
      durationSeconds: seconds,
      aspectRatio: data.aspectRatio ?? "16:9",
      operation: operationName,
    },
    [WORKFLOW_USAGE_KEY]: {
      tokensIn: 0,
      tokensOut: 0,
      // Priced per second of output, which is what Veo charges on.
      costUsd: estimateMediaCostUsd("google:veo-3", seconds),
      model: "google:veo-3",
    },
  };
};
