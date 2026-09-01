/**
 * AF-M8-13: send a `SYSTEM` notification to every workspace (or to named ones).
 *
 * The operator surface for maintenance windows, incident updates, and
 * deprecation notices — the announcements no automated signal produces. See
 * `src/features/notifications/server/system-notifier.ts` for why this is a
 * script rather than an in-app procedure.
 *
 * `--id` is the announcement's identity and its dedupe key. Re-running with
 * the same id reaches only the workspaces that did not receive it, so a
 * half-finished broadcast is safe to simply run again. Use a NEW id only when
 * you mean to announce something new — correcting the wording of an existing
 * announcement should keep the id, or everyone who already read it gets it a
 * second time.
 *
 * Usage:
 *   npm run notify:system -- --id maint-2026-09-14 \
 *     --title "Scheduled maintenance on 14 September" \
 *     --message "Runs will queue for about 20 minutes from 02:00 UTC."
 *
 *   # ...prints the plan and writes nothing. Add --yes to send:
 *   npm run notify:system -- --id maint-2026-09-14 --title "..." --message "..." --yes
 *
 *   # Optional: --href /status, and --org <id> (repeatable) to target.
 */
import "dotenv/config";
import { z } from "zod";
import { broadcastSystemNotification } from "@/features/notifications/server/system-notifier";
import prisma from "@/lib/db";

/** Boundary validation, same rule as any other input (AGENTS.md DO-8). */
const argsSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(100)
    .regex(
      /^[a-z0-9][a-z0-9-]*$/,
      "must be lowercase letters, digits, and hyphens — it is a durable key, not prose",
    ),
  title: z.string().min(1).max(200),
  message: z.string().min(1).max(1000),
  href: z.string().startsWith("/", "must be an in-app path").optional(),
  org: z.array(z.string().min(1)).optional(),
});

const readFlag = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
};

const readRepeatedFlag = (name: string): string[] | undefined => {
  const values = process.argv.flatMap((arg, index) =>
    arg === `--${name}` && process.argv[index + 1]
      ? [process.argv[index + 1]]
      : [],
  );
  return values.length > 0 ? values : undefined;
};

async function main(): Promise<void> {
  const parsed = argsSchema.safeParse({
    id: readFlag("id"),
    title: readFlag("title"),
    message: readFlag("message"),
    href: readFlag("href"),
    org: readRepeatedFlag("org"),
  });

  if (!parsed.success) {
    console.error("Invalid arguments:\n");
    for (const issue of parsed.error.issues) {
      console.error(`  --${issue.path.join(".")}: ${issue.message}`);
    }
    console.error("\nSee the header of this file for usage.");
    process.exitCode = 1;
    return;
  }

  const { id, title, message, href, org } = parsed.data;
  const shouldSend = process.argv.includes("--yes");

  const targets = await prisma.organization.findMany({
    where: org ? { id: { in: org } } : undefined,
    select: { id: true, name: true },
    orderBy: { id: "asc" },
  });

  // Keys are `system:<id>:<organizationId>` (see `systemDedupeKey`), so the
  // count of who already has this announcement is a prefix match.
  const alreadySent = await prisma.notification.count({
    where: { dedupeKey: { startsWith: `system:${id}:` } },
  });

  console.log(`Announcement : ${id}`);
  console.log(`Title        : ${title}`);
  console.log(`Message      : ${message}`);
  console.log(`Link         : ${href ?? "(none)"}`);
  console.log(
    `Audience     : ${org ? `${targets.length} named workspace(s)` : `all workspaces (${targets.length})`}`,
  );

  if (org) {
    const missing = org.filter(
      (requested) => !targets.some((target) => target.id === requested),
    );
    if (missing.length > 0) {
      // Do not silently deliver to fewer workspaces than asked for.
      console.error(
        `\nUnknown organization id(s): ${missing.join(", ")}. Nothing sent.`,
      );
      process.exitCode = 1;
      return;
    }
  }

  if (alreadySent > 0) {
    console.log(
      `\nNote: ${alreadySent} workspace(s) already have "${id}". They will be skipped.`,
    );
  }

  if (targets.length === 0) {
    console.log("\nNo workspaces to notify. Nothing sent.");
    return;
  }

  if (!shouldSend) {
    console.log("\nDry run — nothing written. Re-run with --yes to send.");
    return;
  }

  const result = await broadcastSystemNotification({
    announcementId: id,
    title,
    message,
    href: href ?? null,
    organizationIds: org,
  });

  console.log(
    `\nSent. targeted=${result.targeted} written=${result.written} skipped=${result.skipped}`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
