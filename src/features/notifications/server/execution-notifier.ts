import "server-only";

import prisma from "@/lib/db";

import { buildExecutionNotification } from "../lib/build";
import { writeNotifications } from "./notify";

/**
 * Execution notifications (AF-M7-08).
 *
 * Called from the runner's terminal paths — the success tail and `onFailure`.
 * Both go through here so the preference check happens once, in one place.
 *
 * Delivery is per-workflow (design decision locked 2026-08-30):
 * `notifyOnFailure` defaults ON, `notifyOnSuccess` defaults OFF. A workflow on
 * a five-minute cron would otherwise write 288 rows a day and make the centre
 * worthless.
 */
export async function notifyExecutionFinished(params: {
  executionId: string;
  succeeded: boolean;
  error?: string | null;
}): Promise<number> {
  const execution = await prisma.execution.findUnique({
    where: { id: params.executionId },
    select: {
      id: true,
      workflowId: true,
      mode: true,
      workflow: {
        select: {
          id: true,
          name: true,
          organizationId: true,
          notifyOnFailure: true,
          notifyOnSuccess: true,
        },
      },
    },
  });

  if (!execution?.workflow) return 0;

  // A canvas test run is the user watching the result on screen; telling them
  // about it in a notification centre is noise. Matches the quota gate's
  // treatment of TEST mode.
  if (execution.mode === "TEST") return 0;

  const wanted = params.succeeded
    ? execution.workflow.notifyOnSuccess
    : execution.workflow.notifyOnFailure;
  if (!wanted) return 0;

  return writeNotifications(execution.workflow.organizationId, [
    buildExecutionNotification({
      executionId: execution.id,
      workflowId: execution.workflow.id,
      workflowName: execution.workflow.name,
      succeeded: params.succeeded,
      error: params.error,
    }),
  ]);
}
