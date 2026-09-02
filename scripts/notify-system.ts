/**
 * AF-M8-13: the operator entry point for `SYSTEM` notifications.
 *
 * AF-M7-08 shipped the type, the copy, the icon and the bell, and nothing ever
 * wrote one — so the operator's only way to tell every workspace about
 * maintenance, an incident, or a deprecation was to say nothing. This is that
 * way. It is a script rather than an admin console because there is no admin
 * console (`docs/operations/support.md` §7), and a broadcast to every tenant
 * should be a deliberate command with a written record, not a button.
 *
 * This file is deliberately thin: argument parsing lives in
 * `src/features/notifications/lib/announcement.ts` and the broadcast itself in
 * `src/features/notifications/server/system-notifier.ts`, both of which are
 * tested. A script runs `main()` on import, so anything defined here can only
 * be exercised by actually broadcasting.
 *
 * Usage:
 *   npm run notify:system -- --id maint-2026-09-14 \
 *     --title "Scheduled maintenance" \
 *     --message "Runs may be delayed between 02:00 and 03:00 UTC."
 *
 *   Add --yes to actually write; without it this only reports what it would do.
 *   Add --href /status to give the notification somewhere to go.
 *   Add --org <id> (repeatable) to reach only named workspaces; omit it to
 *   reach every workspace, which is the normal case for maintenance.
 *
 * Dry-run by default: the blast radius is every workspace in the deployment,
 * and there is no unsend.
 *
 * Idempotent per workspace — the dedupe key is `system:<id>:<orgId>` — so a
 * run interrupted halfway is safe to repeat, and re-running with the same
 * `--id` after fixing a typo does NOT announce it a second time to anyone who
 * already has it. Use a new `--id` when you genuinely mean to say it again.
 */
import "dotenv/config";
import { parseAnnouncementArgs } from "@/features/notifications/lib/announcement";
import {
  broadcastSystemNotification,
  previewSystemBroadcast,
} from "@/features/notifications/server/system-notifier";
import prisma from "@/lib/db";

/** Host and database only — never log the password in a connection string. */
const describeTarget = (url: string | undefined): string => {
  if (!url) return "(DATABASE_URL unset)";
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
};

async function main(): Promise<void> {
  const args = parseAnnouncementArgs(process.argv.slice(2));

  try {
    // Name the database being written to. The failure mode this guards against
    // is someone broadcasting to production while believing they are on a
    // laptop, so the target is printed rather than assumed.
    console.log(`Database     : ${describeTarget(process.env.DATABASE_URL)}`);
    console.log(`Announcement : ${args.id}`);
    console.log(`Title        : ${args.title}`);
    console.log(`Message      : ${args.message}`);
    console.log(`Link         : ${args.href ?? "(none)"}`);
    console.log(
      `Audience     : ${
        args.organizationIds
          ? `${args.organizationIds.length} named workspace(s)`
          : "all workspaces"
      }\n`,
    );

    const announcement = {
      announcementId: args.id,
      title: args.title,
      message: args.message,
      href: args.href,
      ...(args.organizationIds
        ? { organizationIds: args.organizationIds }
        : {}),
    };

    if (!args.confirmed) {
      const preview = await previewSystemBroadcast(announcement);

      console.log(`Workspaces          : ${preview.targeted}`);
      console.log(`Already announced to: ${preview.skipped}`);
      console.log(`Would notify        : ${preview.pending}`);
      console.log(
        "\nDRY RUN - nothing was written. Re-run with --yes to send.",
      );
      return;
    }

    const result = await broadcastSystemNotification(announcement);

    console.log(`Workspaces          : ${result.targeted}`);
    console.log(`Already announced to: ${result.skipped}`);
    console.log(`Notified            : ${result.written}`);

    if (result.targeted === 0) {
      console.log("\nNo workspaces exist; nothing to announce.");
      return;
    }
    if (result.written === 0) {
      console.log("\nEvery workspace already had this announcement.");
      return;
    }
    console.log(`\nSENT - ${result.written} workspace(s) notified.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
