import "server-only";
import { NonRetriableError } from "inngest";
import {
  ExecutionStatus,
  NodeExecutionStatus,
} from "@/generated/prisma/client";
import prisma from "@/lib/db";
import type { StepTools } from "@/nodes/types";
import { MEDIA_POLL_SECONDS } from "../constants";

/**
 * The wait shared by `VEO_GENERATE` and `CREATOMATE_RENDER` (AF-M10-23).
 *
 * Both are submit-then-poll jobs that routinely run for minutes, and both meter
 * by output. That combination is what the acceptance's "bounded, cancellable
 * step" is about, and it is the same shape `APIFY_RUN` needed in AF-M10-19 —
 * so it lives here once rather than twice more.
 *
 * The properties that matter, and why:
 *
 * - **Each poll and each sleep is its own durable step.** A wait parked inside
 *   one long `step.run` cannot notice it was cancelled until that step
 *   returns, so "cancel" on a ten-minute render would mean "cancel in ten
 *   minutes". It also frees the worker and survives a redeploy.
 * - **The loop is bounded by a count computed up front**, not only by the
 *   clock: an exit condition that depends on wall-clock progress spins forever
 *   if a sleep ever returns early — on a replay, a clock adjustment, or under
 *   a test double.
 * - **Progress is written to the trace.** A ten-minute render that shows as
 *   RUNNING with no detail is indistinguishable from a hang, so the node is
 *   marked WAITING and its status line updated as the provider reports it.
 */

export interface JobProgress<TJob> {
  job: TJob;
  /** True once the provider says the job reached a terminal state. */
  done: boolean;
  /** A short line for the trace, e.g. "rendering 60%". */
  status: string;
}

export interface PollJobArgs<TJob> {
  step: StepTools;
  nodeId: string;
  executionId: string | undefined;
  /** Poll once. Throwing aborts the wait; the engine's retry rules apply. */
  poll: () => Promise<JobProgress<TJob>>;
  /** Called when the wait expires or the run is cancelled. Best effort. */
  cancelJob?: () => Promise<void>;
  maxWaitSeconds: number;
  where: string;
  /** Names the thing being waited on, for the timeout message. */
  jobLabel: string;
}

/**
 * Wait for a job, durably and cancellably.
 *
 * Returns the terminal job. Throws a NonRetriableError when the wait expires
 * or the workflow is cancelled — in both cases after asking the provider to
 * stop, because a job nobody will read is a bill rather than a loose end.
 */
export async function pollMediaJob<TJob>(
  args: PollJobArgs<TJob>,
): Promise<TJob> {
  const { step, nodeId, executionId, where } = args;
  const maxPolls = Math.ceil(args.maxWaitSeconds / MEDIA_POLL_SECONDS);

  // Distinct status while parked, so a ten-minute render does not read as a
  // hung node. Mirrors what WAIT does for the same reason.
  if (executionId) {
    await step.run(`media-mark-waiting:${nodeId}`, async () => {
      await prisma.nodeExecution.updateMany({
        where: { executionId, nodeId, status: NodeExecutionStatus.RUNNING },
        data: { status: NodeExecutionStatus.WAITING },
      });
    });
  }

  let latest: JobProgress<TJob> | null = null;

  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    // Cast back across the step boundary. Inngest types a step's return as
    // `Jsonify<T>` because it round-trips through JSON for durability — the
    // VALUES are the same, but the static type loses the generic. Everything
    // in JobProgress is JSON-safe by construction, so this is a type-level
    // reconciliation rather than a claim about the data.
    const progress = (await step.run(
      `media-poll:${nodeId}:${attempt}`,
      async () => args.poll(),
    )) as unknown as JobProgress<TJob>;
    latest = progress;

    if (progress.done) {
      return progress.job;
    }

    await step.sleep(
      `media-wait:${nodeId}:${attempt}`,
      MEDIA_POLL_SECONDS * 1000,
    );

    // A cancelled run must stop while it is parked, not when the render
    // finishes — and the provider must be told, or it keeps working and
    // keeps billing.
    if (executionId) {
      const cancelled = await step.run(
        `media-cancel-check:${nodeId}:${attempt}`,
        async () => {
          const live = await prisma.execution.findUnique({
            where: { id: executionId },
            select: { status: true },
          });
          return live?.status === ExecutionStatus.CANCELLED;
        },
      );

      if (cancelled) {
        await step.run(`media-cancel-job:${nodeId}`, async () => {
          await args.cancelJob?.().catch(() => undefined);
          return true;
        });
        throw new NonRetriableError(
          `${where}: the workflow run was cancelled while waiting for the ${args.jobLabel}.`,
        );
      }
    }
  }

  // The wait expired. Ask the provider to stop before giving up: the workflow
  // will never read the result.
  await step.run(`media-abandon:${nodeId}`, async () => {
    await args.cancelJob?.().catch(() => undefined);
    return true;
  });

  throw new NonRetriableError(
    `${where}: the ${args.jobLabel} was still "${latest?.status ?? "running"}" after ${args.maxWaitSeconds}s. Raise the maximum wait if this render is simply slow — the job was asked to stop so it does not keep billing.`,
  );
}
