import { sweepExecutionRetention } from "@/features/executions/server/retention";
import { logger } from "@/lib/logger";
import { inngest } from "./client";

/**
 * Daily enforcement of the execution retention policy (AF-M8-06).
 *
 * Scheduled away from the AI cache sweep (03:15) so the two are not competing
 * for the same tables and connections at the same minute.
 *
 * Correctness does not depend on this running on time. Every stage is bounded
 * and idempotent, so a missed or replayed run only means rows linger a while
 * longer - it can never delete something twice or redact a live payload. When
 * a run hits its batch ceiling it says so in `truncated`, and the next run
 * continues from where it stopped.
 */
export const sweepExecutionHistory = inngest.createFunction(
  {
    id: "sweep-execution-history",
    name: "Enforce Execution Retention Policy",
    concurrency: { limit: 1 },
  },
  { cron: "45 3 * * *" },
  async ({ step }) => {
    const result = await step.run("sweep-execution-retention", async () =>
      sweepExecutionRetention(),
    );

    if (result.truncated) {
      // Not an error: the ceiling exists so one sweep cannot lock the two
      // largest tables for an unbounded time. It is worth seeing, because a
      // run that is truncated every day means the backlog is outgrowing the
      // sweep and the ceiling needs raising.
      logger.warn(
        "execution retention sweep hit its batch ceiling; backlog remains",
        { ...result },
      );
    }

    return result;
  },
);
