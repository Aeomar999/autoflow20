/**
 * AF-M8-13: the producer for `SYSTEM` notifications.
 *
 * AF-M7-08 shipped the type, the copy, the icon and the bell, and nothing ever
 * wrote one — so the operator's only way to tell every workspace about
 * maintenance, an incident, or a deprecation was to say nothing. This is that
 * way. It is a script rather than an admin console because there is no admin
 * console (`docs/operations/support.md` §7), and a broadcast to every tenant
 * should be a deliberate command with a written record, not a button.
 *
 * Usage:
 *   npm run notify:system -- --id maint-2026-09-14 \
 *     --title "Scheduled maintenance" \
 *     --message "Runs may be delayed between 02:00 and 03:00 UTC."
 *
 *   Add --yes to actually write; without it this only reports what it would do.
 *   Add --href /status to give the notification somewhere to go.
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
import { PrismaPg } from "@prisma/adapter-pg";
import { parseAnnouncementArgs } from "@/features/notifications/lib/announcement";
import { buildSystemNotification } from "@/features/notifications/lib/build";
import { PrismaClient } from "@/generated/prisma/client";

/** Host and database only — never log the password in a connection string. */
const describeTarget = (url: string): string => {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
};

async function main(): Promise<void> {
  const args = parseAnnouncementArgs(process.argv.slice(2));

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });

  try {
    // Same reason as verify-legacy-ai-nodes: the failure mode is broadcasting
    // to production while believing you are on a laptop.
    console.log(`Database     : ${describeTarget(databaseUrl)}`);
    console.log(`Announcement : ${args.id}`);
    console.log(`Title        : ${args.title}`);
    console.log(`Message      : ${args.message}`);
    console.log(`Link         : ${args.href ?? "(none)"}\n`);

    const organizations = await prisma.organization.findMany({
      select: { id: true, name: true },
      orderBy: { createdAt: "asc" },
    });

    if (organizations.length === 0) {
      console.log("No workspaces exist; nothing to announce.");
      return;
    }

    // Organisation and draft travel together: pairing two separately filtered
    // arrays by index is exactly how a broadcast ends up writing one
    // workspace's announcement under another workspace's id.
    const targets = organizations.map((organization) => ({
      organization,
      draft: buildSystemNotification({
        announcementId: args.id,
        organizationId: organization.id,
        title: args.title,
        message: args.message,
        href: args.href,
      }),
    }));

    // Report who has already been told BEFORE writing, so a dry run predicts
    // the real outcome instead of just counting workspaces.
    const alreadySent = await prisma.notification.findMany({
      where: { dedupeKey: { in: targets.map(({ draft }) => draft.dedupeKey) } },
      select: { dedupeKey: true },
    });
    const seen = new Set(alreadySent.map((row) => row.dedupeKey));
    const pending = targets.filter(({ draft }) => !seen.has(draft.dedupeKey));

    console.log(`Workspaces          : ${organizations.length}`);
    console.log(`Already announced to: ${seen.size}`);
    console.log(`Would notify        : ${pending.length}`);

    if (!args.confirmed) {
      console.log(
        "\nDRY RUN - nothing was written. Re-run with --yes to send.",
      );
      return;
    }

    if (pending.length === 0) {
      console.log("\nEvery workspace already has this announcement.");
      return;
    }

    const result = await prisma.notification.createMany({
      data: pending.map(({ organization, draft }) => ({
        organizationId: organization.id,
        type: draft.type,
        title: draft.title,
        message: draft.message,
        href: draft.href,
        dedupeKey: draft.dedupeKey,
      })),
      // Belt and braces: a workspace created between the read above and this
      // write, or a concurrent run of this script, collides instead of failing.
      skipDuplicates: true,
    });

    console.log(`\nSENT - ${result.count} workspace(s) notified.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
