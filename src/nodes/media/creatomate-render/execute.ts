import "server-only";
import { NonRetriableError } from "inngest";
import { downloadToFile } from "@/features/files/server/file-service";
import {
  MEDIA_DEFAULT_WAIT_SECONDS,
  MEDIA_MAX_WAIT_SECONDS,
} from "@/features/media/constants";
import { pollMediaJob } from "@/features/media/server/job-poller";
import {
  type CreatomateRender,
  pollCreatomateRender,
  startCreatomateRender,
} from "@/features/media/server/video-clients";
import { WORKFLOW_USAGE_KEY } from "@/inngest/trace";
import { estimateMediaCostUsd } from "@/lib/ai/registry";
import type { NodeRun } from "@/nodes/types";

type CreatomateData = {
  variableName?: string;
  credentialId?: string;
  templateId?: string;
  modifications?: string;
  maxWaitSeconds?: number;
};

export const execute: NodeRun<CreatomateData> = async ({
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
    throw new NonRetriableError(
      "Creatomate node: Variable name not configured",
    );
  }
  if (!data.templateId) {
    throw new NonRetriableError("Creatomate node: Template not configured");
  }
  if (!organizationId) {
    throw new NonRetriableError(
      "Creatomate node: this run has no organization, so a file cannot be stored for it.",
    );
  }

  const where = "Creatomate node";
  const secret = credentials?.credentialId;
  const waitSeconds = Math.min(
    data.maxWaitSeconds ?? MEDIA_DEFAULT_WAIT_SECONDS,
    MEDIA_MAX_WAIT_SECONDS,
  );

  // Submitted in its own step so a retry of the wait cannot start a second
  // render — which would bill twice and produce two videos.
  const started = await step.run(`creatomate-start:${nodeId}`, async () => {
    let modifications: Record<string, unknown> = {};
    if (data.modifications) {
      const rendered = resolve(data.modifications).trim();
      if (rendered.length > 0) {
        try {
          const parsed = JSON.parse(rendered);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("not an object");
          }
          modifications = parsed as Record<string, unknown>;
        } catch {
          throw new NonRetriableError(
            `${where}: the modifications expression did not resolve to a JSON object. Use three braces — {{{json fields}}} — rather than two, which HTML-escapes the quotes.`,
          );
        }
      }
    }

    return startCreatomateRender({
      secret,
      templateId: resolve(data.templateId as string).trim(),
      modifications,
      where,
    });
  });

  const render = await pollMediaJob<CreatomateRender>({
    step,
    nodeId,
    executionId,
    maxWaitSeconds: waitSeconds,
    where,
    jobLabel: "render",
    poll: async () =>
      pollCreatomateRender({
        secret,
        renderId: started.id as string,
        where,
      }),
  });

  if (!render.url) {
    throw new NonRetriableError(
      `${where}: the render finished but Creatomate returned no output URL.`,
    );
  }

  // Stored rather than passed on as a URL: Creatomate's link is a CDN URL tied
  // to the render, and a workflow that hands it downstream is handing on
  // something that will stop working.
  const file = await step.run(`creatomate-store:${nodeId}`, async () =>
    downloadToFile({
      url: render.url as string,
      organizationId,
      executionId,
      workflowId,
      filename: "render.mp4",
    }),
  );

  const seconds = render.output_duration ?? 0;

  return {
    ...context,
    [data.variableName as string]: {
      file,
      renderId: render.id ?? null,
      status: render.status ?? null,
      durationSeconds: seconds,
      snapshotUrl: render.snapshot_url ?? null,
    },
    [WORKFLOW_USAGE_KEY]: {
      tokensIn: 0,
      tokensOut: 0,
      // Based on the render's OWN reported duration rather than a guess, so
      // the estimate tracks what was actually produced.
      costUsd: estimateMediaCostUsd("creatomate:render", seconds),
      model: "creatomate:render",
    },
  };
};
