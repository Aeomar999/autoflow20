/**
 * AF-M5-09 data migration: move persisted `OPENAI` / `ANTHROPIC` / `GEMINI`
 * nodes onto `AI_LLM`, which supersedes all three.
 *
 * Those types stay registered and executable until this has run everywhere —
 * a saved workflow must never break — but they are no longer offered in the
 * palette, so their population can only shrink. Deleting the node folders is a
 * separate, later step (ADR 0011).
 *
 * Scope: live `Node` rows only. `WorkflowVersion.graphSnapshot` and
 * `Execution.graphSnapshot` are history — a published version records what it
 * was, and rewriting it would make the version list lie. Those keep resolving
 * through the still-registered deprecated definitions.
 *
 * Model substitution: the retired executors hard-coded models that are not in
 * the provider registry, so each node moves to the nearest registered model of
 * the same provider. Every substitution is printed. Review the dry run before
 * writing.
 *
 * Usage:
 *   npm run migrate:legacy-ai-nodes          # dry run, prints every change
 *   npm run migrate:legacy-ai-nodes -- --yes # applies them
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { type Prisma, PrismaClient } from "@/generated/prisma/client";
import {
  LEGACY_AI_NODE_MAP,
  LEGACY_AI_NODE_TYPES,
  migrateLegacyAiNode,
} from "@/nodes/ai/legacy-migration";

async function main(): Promise<void> {
  const shouldWrite = process.argv.includes("--yes");
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });

  try {
    const rows = await prisma.node.findMany({
      where: { type: { in: [...LEGACY_AI_NODE_TYPES] } },
      select: {
        id: true,
        type: true,
        name: true,
        data: true,
        workflowId: true,
      },
      orderBy: { id: "asc" },
    });

    if (rows.length === 0) {
      console.log(
        "No OPENAI / ANTHROPIC / GEMINI nodes remain — nothing to migrate.",
      );
      return;
    }

    console.log(
      `Found ${rows.length} legacy AI node(s) across ${new Set(rows.map((r) => r.workflowId)).size} workflow(s).\n`,
    );

    let migrated = 0;
    const failures: Array<{ id: string; reason: string }> = [];

    for (const row of rows) {
      let result: ReturnType<typeof migrateLegacyAiNode>;
      try {
        result = migrateLegacyAiNode(row.type, row.data);
      } catch (error) {
        // One unmappable node must not abort the batch: record it, keep going,
        // and exit non-zero so the run is not mistaken for a clean sweep.
        const reason = error instanceof Error ? error.message : String(error);
        failures.push({ id: row.id, reason });
        console.error(`[SKIP]  ${row.id} (${row.type}): ${reason}`);
        continue;
      }

      const mapping =
        LEGACY_AI_NODE_MAP[row.type as keyof typeof LEGACY_AI_NODE_MAP];

      if (shouldWrite) {
        await prisma.node.update({
          where: { id: row.id },
          data: {
            type: result.type,
            data: result.data as Prisma.InputJsonValue,
          },
        });
      }

      migrated += 1;
      console.log(
        `${shouldWrite ? "[WROTE]" : "[would]"} ${row.id} "${row.name}" ` +
          `${row.type} -> AI_LLM, model ${result.previousModel} -> ${mapping.model}` +
          (result.droppedKeys.length > 0
            ? ` (dropped undeclared keys: ${result.droppedKeys.join(", ")})`
            : ""),
      );
    }

    console.log(
      `\n${shouldWrite ? "Migrated" : "Would migrate"} ${migrated} node(s); ${failures.length} skipped.`,
    );

    if (!shouldWrite) {
      console.log("Dry run — no writes. Re-run with `-- --yes` to apply.");
    }

    if (failures.length > 0) {
      throw new Error(
        `${failures.length} node(s) could not be migrated: ${failures
          .map((failure) => failure.id)
          .join(", ")}`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(
    "migrate-legacy-ai-nodes failed:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
