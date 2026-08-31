/**
 * AF-M7-02: project the authored template catalogue into `Template` rows.
 *
 * `src/features/templates/catalog/` is the source of truth; this script is the
 * only thing that writes the table. It runs the same authoring harness the unit
 * suite runs and refuses to write if anything fails — a template that cannot
 * pass validation must never reach the gallery, where every tenant sees it.
 *
 * Idempotent, keyed on `slug`:
 *   - a slug in the catalogue is created or updated in place;
 *   - `installs` is never touched, because it is usage history, not content;
 *   - a row whose slug has left the catalogue is DEACTIVATED, not deleted, so
 *     the install count and any link to it survive the retirement.
 *
 * Usage:
 *   npm run seed:templates            # dry run, prints every change
 *   npm run seed:templates -- --yes   # applies them
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  checkCatalog,
  formatIssues,
  templateCatalog,
  toSeedRow,
} from "@/features/templates/catalog";
import { type Prisma, PrismaClient } from "@/generated/prisma/client";

async function main(): Promise<void> {
  const shouldWrite = process.argv.includes("--yes");
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  const issues = formatIssues(checkCatalog(templateCatalog));
  if (issues.length > 0) {
    console.error(
      `Refusing to seed: ${issues.length} template issue(s) must be fixed first.\n`,
    );
    for (const issue of issues) {
      console.error(`  - ${issue}`);
    }
    throw new Error("Template catalogue failed validation.");
  }
  console.log(
    `Catalogue clean: ${templateCatalog.length} template(s) passed the harness.\n`,
  );

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });

  try {
    const existing = await prisma.template.findMany({
      select: { slug: true, isActive: true },
    });
    const existingBySlug = new Map(existing.map((row) => [row.slug, row]));

    let created = 0;
    let updated = 0;

    for (const spec of templateCatalog) {
      const row = toSeedRow(spec);
      const isNew = !existingBySlug.has(row.slug);
      console.log(
        `  ${isNew ? "create" : "update"}  ${row.slug.padEnd(30)} ${row.category.padEnd(10)} ${row.nodeCount} nodes, ${row.credentialCount} credential(s)`,
      );

      if (shouldWrite) {
        const content = {
          name: row.name,
          description: row.description,
          category: row.category,
          tags: row.tags,
          featured: row.featured,
          nodeCount: row.nodeCount,
          credentialCount: row.credentialCount,
          graph: row.graph as unknown as Prisma.InputJsonValue,
          isActive: true,
        };
        await prisma.template.upsert({
          where: { slug: row.slug },
          // `installs` is deliberately absent from both branches: on create it
          // takes the column default, on update it keeps whatever the gallery
          // has counted.
          create: { slug: row.slug, ...content },
          update: content,
        });
      }

      if (isNew) created++;
      else updated++;
    }

    const catalogSlugs = new Set(templateCatalog.map((spec) => spec.slug));
    const retired = existing.filter(
      (row) => !catalogSlugs.has(row.slug) && row.isActive,
    );
    for (const row of retired) {
      console.log(`  retire  ${row.slug} (no longer in the catalogue)`);
      if (shouldWrite) {
        await prisma.template.update({
          where: { slug: row.slug },
          data: { isActive: false },
        });
      }
    }

    console.log(
      `\n${shouldWrite ? "Seeded" : "Would seed"} ${created} new and ${updated} existing template(s); ${retired.length} retired.`,
    );
    if (!shouldWrite) {
      console.log("Dry run — no writes. Re-run with `-- --yes` to apply.");
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(
    "seed-templates failed:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
