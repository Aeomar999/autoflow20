import {
  buildCredentialExpiryNotification,
  daysBetween,
} from "@/features/notifications/lib/build";
import { writeNotifications } from "@/features/notifications/server/notify";
import prisma from "@/lib/db";

import { inngest } from "./client";

/**
 * Credential-expiry warnings (AF-M7-08).
 *
 * Design decision (locked 2026-08-30): a scheduled sweep over
 * `oauthExpiresAt` with a +7d window, reusing the `scheduledKnowledgeSync`
 * shape. Daily rather than hourly — the window is a week, so an hourly sweep
 * would buy nothing and re-scan every credential 24 times a day.
 *
 * Safe to run repeatedly. Each notification's dedupe key is composed from the
 * credential id and the expiry INSTANT, so a given expiry is announced exactly
 * once no matter how often this fires; a refreshed token gets a new expiry,
 * hence a new key, hence a genuinely new warning.
 */

/** How far ahead to warn. */
export const CREDENTIAL_EXPIRY_WINDOW_DAYS = 7;

/**
 * How far back to keep warning about credentials that already lapsed. Without
 * a floor, every credential ever abandoned would be re-announced forever; with
 * one, a lapse is surfaced for a fortnight and then stops nagging.
 */
export const CREDENTIAL_EXPIRY_GRACE_DAYS = 14;

export const notifyExpiringCredentials = inngest.createFunction(
  {
    id: "notify-expiring-credentials",
    name: "Warn About Expiring Credentials",
  },
  { cron: "0 3 * * *" },
  async ({ step }) => {
    const now = new Date();
    const horizon = new Date(
      now.getTime() + CREDENTIAL_EXPIRY_WINDOW_DAYS * 86_400_000,
    );
    const floor = new Date(
      now.getTime() - CREDENTIAL_EXPIRY_GRACE_DAYS * 86_400_000,
    );

    const expiring = await step.run("list-expiring-credentials", async () => {
      return prisma.credential.findMany({
        where: {
          oauthExpiresAt: { not: null, gte: floor, lte: horizon },
          // A credential with no organization predates the org backfill and
          // has no workspace to notify. Skipped rather than guessed at.
          organizationId: { not: null },
        },
        select: {
          id: true,
          name: true,
          organizationId: true,
          oauthExpiresAt: true,
        },
        orderBy: { oauthExpiresAt: "asc" },
      });
    });

    if (expiring.length === 0) {
      return { scanned: 0, written: 0 };
    }

    // Grouped so each workspace's warnings are one write, not one per row.
    const byOrg = new Map<string, typeof expiring>();
    for (const credential of expiring) {
      const orgId = credential.organizationId as string;
      const bucket = byOrg.get(orgId) ?? [];
      bucket.push(credential);
      byOrg.set(orgId, bucket);
    }

    let written = 0;
    for (const [organizationId, credentials] of byOrg) {
      written += await step.run(`notify-org-${organizationId}`, async () =>
        writeNotifications(
          organizationId,
          credentials.map((credential) => {
            // `step.run` results cross Inngest's JSON boundary, so the Date
            // Prisma returned arrives here as an ISO string. Rehydrating it is
            // not a formality: `daysBetween` does arithmetic on it, and the
            // dedupe key is built from `toISOString()`.
            const expiresAt = new Date(credential.oauthExpiresAt as string);
            return buildCredentialExpiryNotification({
              credentialId: credential.id,
              credentialName: credential.name,
              expiresAt,
              daysRemaining: daysBetween(now, expiresAt),
            });
          }),
        ),
      );
    }

    return { scanned: expiring.length, written };
  },
);
