import { CronExpressionParser } from "cron-parser";
import prisma from "@/lib/db";
import { logger } from "@/lib/logger";
import { inngest } from "./client";
import { sendWorkflowExecution } from "./utils";

/**
 * Single job evaluating all active schedule nodes (AF-M4-04).
 * Runs every minute to see if any published workflows with SCHEDULE_TRIGGER
 * need to be executed at this minute.
 */
export const evaluateSchedules = inngest.createFunction(
  { id: "evaluate-schedules" },
  { cron: "* * * * *" }, // Run every minute
  async ({ step }) => {
    // 1. Fetch all active workflows (must have activeVersionId)
    const activeWorkflows = await step.run(
      "fetch-active-workflows",
      async () => {
        return prisma.workflow.findMany({
          where: { activeVersionId: { not: null } },
          select: {
            id: true,
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

    const now = new Date();
    // Normalize to start of current minute for accurate matching
    const currentMinute = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      now.getHours(),
      now.getMinutes(),
    );

    const triggeredWorkflows: string[] = [];

    await step.run("evaluate-and-trigger", async () => {
      for (const workflow of activeWorkflows) {
        if (!workflow.activeVersion?.graphSnapshot) continue;

        try {
          const snapshot =
            typeof workflow.activeVersion.graphSnapshot === "string"
              ? JSON.parse(workflow.activeVersion.graphSnapshot)
              : workflow.activeVersion.graphSnapshot;

          const nodes = snapshot.nodes || [];

          for (const node of nodes) {
            if (node.type === "SCHEDULE_TRIGGER") {
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
                  // MATCH! Trigger it.
                  logger.info(
                    `Schedule trigger matched for workflow ${workflow.id}`,
                    { cronStr, tz },
                  );

                  await sendWorkflowExecution({
                    workflowId: workflow.id,
                    initialData: {
                      schedule: {
                        timestamp: currentMinute.toISOString(),
                        cron: cronStr,
                        timezone: tz,
                      },
                    },
                  });
                  triggeredWorkflows.push(workflow.id);
                  // Break outer node loop, only trigger once per workflow even if multiple triggers exist
                  break;
                }
              } catch (e) {
                logger.warn(
                  `Invalid cron expression in workflow ${workflow.id}: ${cronStr}`,
                  { error: e },
                );
              }
            }
          }
        } catch (e) {
          logger.error(
            `Failed to parse graphSnapshot for workflow ${workflow.id}`,
            { error: e },
          );
        }
      }
    });

    return {
      triggered: triggeredWorkflows.length,
      workflows: triggeredWorkflows,
    };
  },
);
