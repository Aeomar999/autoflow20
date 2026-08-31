import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import prisma from "@/lib/db";
import { logger } from "@/lib/logger";

import type { NotificationDraft } from "../lib/build";

/**
 * The single write path for notifications (AF-M7-08).
 *
 * Every producer — the runner tail, the credential-expiry cron, anything added
 * later — goes through here, so replay-safety and the never-break-the-caller
 * rule are enforced in one place rather than remembered at each call site.
 */

/**
 * Write notifications, skipping any whose `dedupeKey` already exists.
 *
 * Returns the number actually written.
 *
 * Failures are logged and swallowed. This is called from the runner tail and
 * from crons: a notification is a courtesy, and failing a user's workflow run
 * because we could not tell them it succeeded would be absurd. The swallow is
 * deliberate and narrow — it is here, at the single write path, and nowhere
 * else — and it logs at error level so a broken notifier is visible rather
 * than silent.
 */
export async function writeNotifications(
  organizationId: string,
  drafts: NotificationDraft[],
): Promise<number> {
  if (drafts.length === 0) return 0;

  try {
    const result = await prisma.notification.createMany({
      data: drafts.map(
        (draft): Prisma.NotificationCreateManyInput => ({
          organizationId,
          type: draft.type,
          title: draft.title,
          message: draft.message,
          href: draft.href,
          dedupeKey: draft.dedupeKey,
          workflowId: draft.workflowId,
          executionId: draft.executionId,
          credentialId: draft.credentialId,
        }),
      ),
      // The replay guard. A retried step collides on `dedupeKey` and is
      // skipped rather than announcing the same thing a second time.
      skipDuplicates: true,
    });
    return result.count;
  } catch (error) {
    logger.error("Failed to write notifications", {
      organizationId,
      count: drafts.length,
      // Types and keys only — a notification body can quote a run's error
      // message, and that has no business being duplicated into the logs.
      types: drafts.map((draft) => draft.type),
      reason: error instanceof Error ? error.message : "unknown",
    });
    return 0;
  }
}
