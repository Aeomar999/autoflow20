import "server-only";
import { NonRetriableError } from "inngest";
import {
  APIFY_MAX_WAIT_SECONDS,
  APIFY_POLL_SECONDS,
} from "@/features/apify/constants";
import {
  type ApifyRun,
  abortApifyRun,
  describeRunOutcome,
  getApifyRun,
  isTerminal,
  startApifyRun,
} from "@/features/apify/server/apify-client";
import { ExecutionStatus } from "@/generated/prisma/client";
import prisma from "@/lib/db";
import type { NodeRun } from "@/nodes/types";

type ApifyRunData = {
  variableName?: string;
  credentialId?: string;
  actorId?: string;
  input?: string;
  waitForFinish?: boolean;
  maxWaitSeconds?: number;
  memoryMbytes?: number;
};

/**
 * `APIFY_RUN` (AF-M10-19).
 *
 * The wait is **not** wrapped in a single `step.run`. Each poll and each sleep
 * is its own durable step, which is what makes the wait cancellable: a run
 * parked inside one long-running step cannot notice it was cancelled until the
 * step returns, so "cancel" would mean "cancel in ten minutes". It also means
 * the worker is not held for the length of a scrape and the wait survives a
 * redeploy.
 *
 * Every path that stops waiting **aborts the actor run**. Apify bills compute
 * units for as long as an actor is alive, so a run nobody is waiting on is a
 * bill rather than a loose end.
 */
export const execute: NodeRun<ApifyRunData> = async ({
  data,
  nodeId,
  executionId,
  context,
  resolve,
  step,
  credentials,
}) => {
  if (!data.variableName) {
    throw new NonRetriableError("Apify Run node: Variable name not configured");
  }
  if (!data.actorId) {
    throw new NonRetriableError("Apify Run node: Actor not configured");
  }

  const where = "Apify Run node";
  const secret = credentials?.credentialId;
  const waitSeconds = Math.min(
    data.maxWaitSeconds ?? 300,
    APIFY_MAX_WAIT_SECONDS,
  );

  // Start in its own step so a retry of a later step does not launch a second
  // actor run — which would bill twice and produce two datasets.
  const started = await step.run(`apify-start:${nodeId}`, async () => {
    let input: unknown;
    if (data.input) {
      const rendered = resolve(data.input).trim();
      if (rendered.length > 0) {
        try {
          input = JSON.parse(rendered);
        } catch {
          throw new NonRetriableError(
            `${where}: the input expression did not resolve to JSON. Use three braces — {{{json actorInput}}} — rather than two, which HTML-escapes the quotes.`,
          );
        }
      }
    }

    return startApifyRun({
      secret,
      actorId: resolve(data.actorId as string),
      input,
      memoryMbytes: data.memoryMbytes,
      // Apify's own timeout, set a little above ours: if this workflow dies
      // between polls the run still stops on its own rather than billing until
      // somebody notices.
      timeoutSecs: waitSeconds + 60,
      where,
    });
  });

  const finish = (run: ApifyRun, waited: boolean) => ({
    ...context,
    [data.variableName as string]: {
      runId: run.id,
      status: run.status,
      datasetId: run.defaultDatasetId ?? null,
      keyValueStoreId: run.defaultKeyValueStoreId ?? null,
      startedAt: run.startedAt ?? null,
      finishedAt: run.finishedAt ?? null,
      // Surfaced because it is what Apify bills on. A workflow whose cost
      // doubled should be able to see that here rather than in an invoice.
      computeUnits: run.stats?.computeUnits ?? null,
      runTimeSeconds: run.stats?.runTimeSecs ?? null,
      waited,
    },
  });

  if (data.waitForFinish === false) {
    return finish(started, false);
  }

  // Bounded by a count computed up front, not only by the clock: a loop whose
  // exit depends on wall-clock progress spins forever if a sleep ever returns
  // early — on a replay, a clock adjustment, or under a test double.
  const maxPolls = Math.ceil(waitSeconds / APIFY_POLL_SECONDS);
  let latest = started;

  for (let poll = 0; poll < maxPolls; poll += 1) {
    if (isTerminal(latest.status)) break;

    await step.sleep(`apify-wait:${nodeId}:${poll}`, APIFY_POLL_SECONDS * 1000);

    // A cancelled run must stop while it is parked, not when it finally
    // finishes — and the actor must be told, or it keeps billing.
    if (executionId) {
      const cancelled = await step.run(
        `apify-cancel-check:${nodeId}:${poll}`,
        async () => {
          const live = await prisma.execution.findUnique({
            where: { id: executionId },
            select: { status: true },
          });
          return live?.status === ExecutionStatus.CANCELLED;
        },
      );

      if (cancelled) {
        const aborted = await step.run(
          `apify-abort-cancelled:${nodeId}`,
          async () => abortApifyRun({ secret, runId: started.id, where }),
        );
        throw new NonRetriableError(
          `${where}: the workflow run was cancelled while waiting for the actor.${
            aborted
              ? ` Apify run ${started.id} was aborted.`
              : ` Apify run ${started.id} could NOT be aborted and may still be billing — stop it in the Apify console.`
          }`,
        );
      }
    }

    latest = await step.run(`apify-poll:${nodeId}:${poll}`, async () =>
      getApifyRun({ secret, runId: started.id, where }),
    );
  }

  if (!isTerminal(latest.status)) {
    // Our wait expired. Abort rather than leave it running: the workflow will
    // never read the result, and Apify bills until the actor stops.
    const aborted = await step.run(`apify-abort-timeout:${nodeId}`, async () =>
      abortApifyRun({ secret, runId: started.id, where }),
    );
    throw new NonRetriableError(
      `${where}: the actor was still ${latest.status} after ${waitSeconds}s.${
        aborted
          ? ` Run ${started.id} was aborted so it stops billing.`
          : ` Run ${started.id} could NOT be aborted and may still be billing — stop it in the Apify console.`
      } Raise the maximum wait if this actor is simply slow, or turn the wait off and fetch the dataset in a later run.`,
    );
  }

  // Apify reports actor failure as a SUCCESSFUL API response describing a
  // failed run. Without this the node would report success and hand an empty
  // dataset to the next step.
  const failure = describeRunOutcome(latest, where);
  if (failure) throw failure;

  return finish(latest, true);
};
