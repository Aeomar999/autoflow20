import { CronExpressionParser } from "cron-parser";
import { sweepPollingTriggers } from "@/features/triggers/server/polling-sweep";
import prisma from "@/lib/db";
import { logger } from "@/lib/logger";
import { inngest } from "./client";
import { sendWorkflowExecution } from "./utils";

/**
 * A single schedule trigger match ready to dispatch. `timestamp` is the
 * normalized start-of-minute the cron expression fired on.
 */
export interface ScheduleDispatch {
  workflowId: string;
  cron: string;
  timezone: string;
  timestamp: string;
}

/**
 * The shape of the active-workflow rows the evaluator fetches. The `nodes`
 * type is deliberately loose: `graphSnapshot` is a Prisma `Json` column whose
 * shape is produced by `workflows.publish` (each node carries `disabled`).
 */
export interface ActiveWorkflowForSchedule {
  id: string;
  /** Tenant the run belongs to — required to resolve a poller's credentials. */
  organizationId: string;
  activeVersion: { graphSnapshot: unknown } | null;
}

/** Loose shape of a published snapshot node (produced by `workflows.publish`). */
type SnapshotNode = {
  type?: string;
  disabled?: boolean;
  data?: { cron?: string; timezone?: string };
};

/**
 * Decide which active workflows' schedule triggers fire at `now`.
 *
 * This is the pure core of the `evaluate-schedules` job, extracted so the
 * trigger decision is testable without driving an Inngest function. It walks
 * each workflow's published graph snapshot for a `SCHEDULE_TRIGGER` node and:
 *  - silently skips a workflow whose schedule trigger is disabled (AF-M9-17),
 *    without logging — the job ticks every minute, so a per-tick log would be
 *    noise for an intentional authoring state, not a failure;
 *  - dispatches at most once per workflow (the first matching trigger wins).
 */
export function collectScheduledDispatches(
  activeWorkflows: ActiveWorkflowForSchedule[],
  now: Date,
): ScheduleDispatch[] {
  // Normalize to start of current minute for accurate matching.
  const currentMinute = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    now.getHours(),
    now.getMinutes(),
  );

  const dispatches: ScheduleDispatch[] = [];

  for (const workflow of activeWorkflows) {
    if (!workflow.activeVersion?.graphSnapshot) continue;

    try {
      const snapshot =
        typeof workflow.activeVersion.graphSnapshot === "string"
          ? (JSON.parse(workflow.activeVersion.graphSnapshot) as {
              nodes?: SnapshotNode[];
            })
          : (workflow.activeVersion.graphSnapshot as {
              nodes?: SnapshotNode[];
            });

      const nodes = snapshot.nodes || [];

      for (const node of nodes) {
        if (!node || node.type !== "SCHEDULE_TRIGGER") continue;

        // AF-M9-17: a disabled schedule trigger must not dispatch a run. Deliberately
        // no log — see the comment on the function.
        if (node.disabled === true) continue;

        const cronStr = node.data?.cron || "0 * * * *";
        const tz = node.data?.timezone || "UTC";

        try {
          // Parse expression and check if the *previous* run time matches the current minute
          // (or rather, just check if current minute is a valid run time)
          const interval = CronExpressionParser.parse(cronStr, {
            currentDate: new Date(currentMinute.getTime() - 1000), // Start just before current minute
            tz,
          });

          const nextRun = interval.next();
          if (nextRun.getTime() === currentMinute.getTime()) {
            dispatches.push({
              workflowId: workflow.id,
              cron: cronStr,
              timezone: tz,
              timestamp: currentMinute.toISOString(),
            });
            // Only trigger once per workflow even if multiple triggers exist.
            break;
          }
        } catch (e) {
          logger.warn(
            `Invalid cron expression in workflow ${workflow.id}: ${cronStr}`,
            { error: e },
          );
        }
      }
    } catch (e) {
      logger.error(
        `Failed to parse graphSnapshot for workflow ${workflow.id}`,
        { error: e },
      );
    }
  }

  return dispatches;
}

/**
 * Single job evaluating all active schedule nodes (AF-M4-04) and sweeping
 * every polling trigger (AF-M10-05).
 *
 * Both live here rather than in a second cron function on purpose: they read
 * the same set of published workflows, run on the same one-minute tick, and a
 * separate job would double that read and let the two drift out of step over
 * what "active" means.
 */
export const evaluateSchedules = inngest.createFunction(
  {
    id: "evaluate-schedules",
    concurrency: [{ limit: 1 }],
  },
  { cron: "* * * * *" }, // Run every minute
  async ({ step }) => {
    // 1. Fetch all active workflows (must have activeVersionId)
    const activeWorkflows = await step.run(
      "fetch-active-workflows",
      async (): Promise<ActiveWorkflowForSchedule[]> => {
        return prisma.workflow.findMany({
          where: { activeVersionId: { not: null } },
          select: {
            id: true,
            organizationId: true,
            activeVersion: {
              select: {
                id: true,
                graphSnapshot: true,
              },
            },
          },
        });
      },
    );

    const triggeredWorkflows: string[] = [];

    await step.run("evaluate-and-trigger", async () => {
      const dispatches = collectScheduledDispatches(
        activeWorkflows,
        new Date(),
      );

      for (const dispatch of dispatches) {
        logger.info(
          `Schedule trigger matched for workflow ${dispatch.workflowId}`,
          { cronStr: dispatch.cron, tz: dispatch.timezone },
        );

        await sendWorkflowExecution({
          workflowId: dispatch.workflowId,
          initialData: {
            schedule: {
              timestamp: dispatch.timestamp,
              cron: dispatch.cron,
              timezone: dispatch.timezone,
            },
          },
        });
        triggeredWorkflows.push(dispatch.workflowId);
      }
    });

    // AF-M10-05: the polling sweep. Its own step, so a provider outage in one
    // poller cannot make the schedule evaluation above look like it failed —
    // and so the two are memoized separately on an Inngest retry.
    const polling = await step.run("sweep-polling-triggers", async () =>
      sweepPollingTriggers({ workflows: activeWorkflows, now: new Date() }),
    );

    if (polling.skipped > 0) {
      // The budget is doing its job, but a sustained backlog means the install
      // has outgrown one sweep per minute and someone should know.
      logger.warn(
        `Polling sweep hit its per-tick budget; ${polling.skipped} triggers deferred`,
      );
    }

    return {
      triggered: triggeredWorkflows.length,
      workflows: triggeredWorkflows,
      polling,
    };
  },
);
