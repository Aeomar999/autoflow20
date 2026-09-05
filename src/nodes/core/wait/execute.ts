import "server-only";
import { NonRetriableError } from "inngest";
import {
  ExecutionStatus,
  NodeExecutionStatus,
} from "@/generated/prisma/client";
import prisma from "@/lib/db";
import type { NodeRun } from "@/nodes/types";
import { MAX_WAIT_SECONDS } from "./definition";

/**
 * `WAIT` (AF-M10-08).
 *
 * Backed by Inngest's durable sleep, not a polling loop: the worker is not
 * held, and the run resumes on a different worker if this one is long gone.
 *
 * The sleep is **chunked** rather than one long call. A six-day
 * `step.sleepUntil` is durable but opaque: the run cannot notice it was
 * cancelled until it wakes, so "cancel" on a parked run would mean "cancel in
 * six days". Waking hourly to check costs one cheap read per hour and makes
 * cancellation mean what the button says.
 */

/** Longest single sleep. Also the worst-case delay before a cancel is noticed. */
const CHUNK_SECONDS = 60 * 60;

type WaitData = {
  mode?: "duration" | "until";
  seconds?: number;
  until?: string;
};

export const execute: NodeRun<WaitData> = async ({
  data,
  nodeId,
  executionId,
  context,
  resolve,
  step,
}) => {
  const mode = data.mode ?? "duration";

  // Resolve the wake time once, in its own step, so a replay does not shift
  // the target every time the function is retried.
  const wakeAtMs = await step.run("wait-resolve-target", async () => {
    if (mode === "until") {
      if (!data.until) {
        throw new NonRetriableError(
          "Wait node: no timestamp configured for `until` mode",
        );
      }
      const rendered = resolve(data.until).trim();
      const target = new Date(rendered);
      if (Number.isNaN(target.getTime())) {
        throw new NonRetriableError(
          `Wait node: "${rendered}" is not a timestamp this node can read. Use ISO 8601, e.g. 2026-09-04T14:00:00Z.`,
        );
      }

      const deltaSeconds = (target.getTime() - Date.now()) / 1000;
      if (deltaSeconds > MAX_WAIT_SECONDS) {
        throw new NonRetriableError(
          `Wait node: that timestamp is ${Math.round(deltaSeconds / 86_400)} days away, beyond the ${MAX_WAIT_SECONDS / 86_400}-day maximum wait.`,
        );
      }

      // A target already past resolves immediately. Waking late is the honest
      // outcome — the graph computed a time and the clock moved on — whereas
      // failing the run would turn a slightly slow upstream node into an
      // outage.
      return target.getTime();
    }

    const seconds = data.seconds ?? 0;
    if (seconds <= 0) {
      throw new NonRetriableError(
        "Wait node: duration must be at least one second",
      );
    }
    if (seconds > MAX_WAIT_SECONDS) {
      throw new NonRetriableError(
        `Wait node: ${seconds}s exceeds the ${MAX_WAIT_SECONDS}s maximum wait.`,
      );
    }
    return Date.now() + seconds * 1000;
  });

  const wakeAt = new Date(wakeAtMs);

  // Captured BEFORE sleeping. Computing it afterwards makes it unconditionally
  // true — by the time the node returns, the wake time is always in the past.
  const resolvedImmediately = wakeAtMs <= Date.now();

  if (!resolvedImmediately) {
    // Distinct status while parked, so a run waiting six days does not read as
    // hung. `finishedAt` stays null; the engine's trace-end writes SUCCESS
    // when the executor returns.
    if (executionId) {
      await step.run(`wait-mark-waiting:${nodeId}`, async () => {
        await prisma.nodeExecution.updateMany({
          where: { executionId, nodeId, status: NodeExecutionStatus.RUNNING },
          data: { status: NodeExecutionStatus.WAITING },
        });
      });
    }

    // Bounded by a count computed up front, not only by the clock. A loop whose
    // exit depends on wall-clock progress spins forever if a sleep ever
    // returns early — during a replay, on a clock adjustment, or under a test
    // double. The clock check below still ends it early when time really has
    // passed; this is the guard that makes termination unconditional.
    const maxChunks =
      Math.ceil((wakeAtMs - Date.now()) / (CHUNK_SECONDS * 1000)) + 1;

    for (let chunk = 0; chunk < maxChunks; chunk += 1) {
      const remainingMs = wakeAtMs - Date.now();
      if (remainingMs <= 0) {
        break;
      }

      const sleepMs = Math.min(remainingMs, CHUNK_SECONDS * 1000);
      await step.sleep(`wait:${nodeId}:${chunk}`, sleepMs);

      // AF-M8-27: a cancelled run must stop while it is parked, not when it
      // finally wakes. The engine's own per-node check only runs between
      // nodes, and this node is one node.
      if (executionId) {
        const cancelled = await step.run(
          `wait-cancel-check:${nodeId}:${chunk}`,
          async () => {
            const live = await prisma.execution.findUnique({
              where: { id: executionId },
              select: { status: true },
            });
            return live?.status === ExecutionStatus.CANCELLED;
          },
        );
        if (cancelled) {
          throw new NonRetriableError(
            "Wait node: the run was cancelled while waiting.",
          );
        }
      }
    }
  }

  return {
    ...context,
    wait: {
      mode,
      wakeAt: wakeAt.toISOString(),
      // True when the target had already passed — visible in the trace so an
      // author can see their `until` expression is computing the past.
      resolvedImmediately,
    },
  };
};
