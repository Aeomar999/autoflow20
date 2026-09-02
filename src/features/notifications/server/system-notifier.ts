import "server-only";

import prisma from "@/lib/db";
import { logger } from "@/lib/logger";

import { buildSystemNotification, systemDedupeKey } from "../lib/build";
import { writeNotifications } from "./notify";

/**
 * The `SYSTEM` notification producer (AF-M8-13).
 *
 * Maintenance windows, incident updates, deprecation notices - the things an
 * operator needs to tell every workspace, which no automated signal produces.
 *
 * **Why a script surface rather than an operator-only procedure.** There is no
 * platform-admin role: `Role` is org-scoped (OWNER/ADMIN/EDITOR/VIEWER), so an
 * in-app operator procedure would mean inventing a cross-tenant privilege and
 * exposing it on the public app - a materially larger and riskier change than
 * this task, for an action performed a handful of times a year. A script runs
 * with database credentials, which the operator already holds, and adds no new
 * authenticated surface. It matches the existing `scripts/` pattern
 * (`migrate-credentials`, `verify-legacy-ai-nodes`, `seed-templates`),
 * including dry-run-by-default.
 *
 * The logic lives here rather than in the script so it can be tested against a
 * real database, and so a future in-app surface has something to call.
 */

export interface SystemAnnouncement {
  /**
   * Stable, operator-chosen identity for this announcement, e.g.
   * `maint-2026-09-14`. It is the dedupe key, and therefore the only thing
   * standing between a half-failed broadcast and telling everyone twice.
   */
  announcementId: string;
  title: string;
  message: string;
  /** Optional in-app link, e.g. `/status`. */
  href?: string | null;
  /**
   * Restrict delivery to these organizations. Omit to reach every
   * organization - the normal case for maintenance and incidents.
   */
  organizationIds?: string[];
}

export interface SystemAnnouncementResult {
  /** Organizations the announcement was addressed to. */
  targeted: number;
  /** Rows actually written - lower than `targeted` on a re-run. */
  written: number;
  /** Organizations that already had this announcement. */
  skipped: number;
}

export interface SystemAnnouncementPreview {
  /** Organizations the announcement would be addressed to. */
  targeted: number;
  /** Organizations that would receive it. */
  pending: number;
  /** Organizations that already have it, and would be skipped. */
  skipped: number;
}

/** Organizations written per statement, so one broadcast is not one huge write. */
export const SYSTEM_BROADCAST_BATCH_SIZE = 200;

/** Ids of every organization this announcement is addressed to, in a stable order. */
const resolveTargets = async (
  announcement: SystemAnnouncement,
): Promise<string[]> => {
  const organizations = await prisma.organization.findMany({
    where: announcement.organizationIds
      ? { id: { in: announcement.organizationIds } }
      : undefined,
    select: { id: true },
    orderBy: { id: "asc" },
  });
  return organizations.map((organization) => organization.id);
};

/**
 * What a broadcast would do, without doing it.
 *
 * This is the dry run, and it lives here rather than in the calling script for
 * the same reason the write path does: the operator decides whether to send
 * based on these numbers, so they need to be tested against a real database
 * rather than assembled ad hoc at the call site.
 *
 * Reads in the same batches as the write, so previewing a broadcast to a large
 * fleet does not become one enormous `IN` list.
 */
export const previewSystemBroadcast = async (
  announcement: SystemAnnouncement,
): Promise<SystemAnnouncementPreview> => {
  const targets = await resolveTargets(announcement);

  let skipped = 0;
  for (
    let offset = 0;
    offset < targets.length;
    offset += SYSTEM_BROADCAST_BATCH_SIZE
  ) {
    const batch = targets.slice(offset, offset + SYSTEM_BROADCAST_BATCH_SIZE);
    skipped += await prisma.notification.count({
      where: {
        dedupeKey: {
          in: batch.map((organizationId) =>
            systemDedupeKey(announcement.announcementId, organizationId),
          ),
        },
      },
    });
  }

  return {
    targeted: targets.length,
    pending: targets.length - skipped,
    skipped,
  };
};

/**
 * Send one announcement to every targeted organization.
 *
 * Idempotent by `dedupeKey`: re-running with the same `announcementId` writes
 * only to organizations that did not receive it, which is what makes a
 * half-finished broadcast safe to simply run again.
 *
 * Each organization is written separately because `Notification` is
 * org-scoped and `writeNotifications` takes one org - the batching here is
 * about bounding the loop, not about a single multi-tenant insert.
 *
 * Everything goes through `writeNotifications` rather than a direct
 * `createMany`, so the replay guard and the never-break-the-caller rule stay
 * enforced in one place instead of being re-implemented per producer.
 */
export const broadcastSystemNotification = async (
  announcement: SystemAnnouncement,
): Promise<SystemAnnouncementResult> => {
  const targets = await resolveTargets(announcement);

  let written = 0;

  for (
    let offset = 0;
    offset < targets.length;
    offset += SYSTEM_BROADCAST_BATCH_SIZE
  ) {
    const batch = targets.slice(offset, offset + SYSTEM_BROADCAST_BATCH_SIZE);

    for (const organizationId of batch) {
      // The draft is built per organization because the dedupe key contains
      // the organization id - see `systemDedupeKey`.
      written += await writeNotifications(organizationId, [
        buildSystemNotification({
          announcementId: announcement.announcementId,
          organizationId,
          title: announcement.title,
          message: announcement.message,
          href: announcement.href ?? null,
        }),
      ]);
    }
  }

  const result: SystemAnnouncementResult = {
    targeted: targets.length,
    written,
    skipped: targets.length - written,
  };

  logger.info("system announcement broadcast", {
    announcementId: announcement.announcementId,
    ...result,
  });

  return result;
};
