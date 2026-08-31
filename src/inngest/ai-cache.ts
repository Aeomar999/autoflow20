import { purgeExpiredAiCache } from "@/lib/ai/cache";
import { logger } from "@/lib/logger";
import { inngest } from "./client";

/**
 * Daily sweep of expired AI response-cache entries (AF-M5-07).
 *
 * Correctness does not depend on this running: every read already filters on
 * `expiresAt`, so a missed sweep can only leave dead rows behind, never serve
 * a stale answer. It exists so the table stays bounded.
 */
export const sweepAiResponseCache = inngest.createFunction(
  {
    id: "sweep-ai-response-cache",
    name: "Sweep Expired AI Response Cache Entries",
    concurrency: { limit: 1 },
  },
  { cron: "15 3 * * *" },
  async ({ step }) => {
    const deletedCount = await step.run("purge-expired-entries", async () => {
      const count = await purgeExpiredAiCache();
      logger.info("AI response cache sweep complete", { deletedCount: count });
      return count;
    });

    return { deletedCount };
  },
);
