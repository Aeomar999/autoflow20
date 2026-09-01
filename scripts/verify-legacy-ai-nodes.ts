/**
 * AF-M8-12 precondition check: is it safe for the deprecated AI node types to
 * be gone from this deployment's database?
 *
 * `OPENAI` / `ANTHROPIC` / `GEMINI` were deleted from the registry. Removing a
 * registration while a persisted node still holds that type makes `validate()`
 * throw `UnknownNodeTypeError` and fails the whole graph **at execution time,
 * on a customer's live workflow** (ADR-0011 §3). So this has to be true in
 * EVERY environment, not just the one a developer happens to have in `.env`.
 *
 * Read-only. It runs two SELECTs and writes nothing, so it is safe to point at
 * production - which is the whole point of it existing as a script rather than
 * as two queries pasted into a console.
 *
 * Usage:
 *   npm run verify:legacy-ai-nodes                      # whatever .env points at
 *   DATABASE_URL='<prod-url>' npm run verify:legacy-ai-nodes
 *
 * Exits 0 when clear, 1 when rows remain - so it can gate a deploy.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const RETIRED = ["OPENAI", "ANTHROPIC", "GEMINI"] as const;

/** Neon/RDS style host, with credentials stripped - never log the password. */
const describeTarget = (url: string): string => {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
};

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });

  try {
    // Name the database being checked. The failure mode this script exists to
    // prevent is someone verifying their laptop and believing they verified
    // production, so the target is printed rather than assumed.
    console.log(`Database : ${describeTarget(databaseUrl)}\n`);

    // 1. Live nodes. These are what break at execution time.
    const liveNodes = await prisma.$queryRaw<
      { type: string; count: bigint }[]
    >`SELECT type, count(*) AS count
        FROM "Node"
       WHERE type IN ('OPENAI', 'ANTHROPIC', 'GEMINI')
       GROUP BY type`;

    // 2. Active published versions. A version's graphSnapshot is history and
    //    is deliberately never rewritten (ADR-0011), but the ACTIVE one is
    //    what a trigger executes, so a match here breaks runs too.
    const activeVersions = await prisma.$queryRaw<
      { id: string; name: string }[]
    >`SELECT w.id, w.name
        FROM "Workflow" w
        JOIN "WorkflowVersion" v ON v.id = w."activeVersionId"
       WHERE v."graphSnapshot"::text ~ '"type"\\s*:\\s*"(OPENAI|ANTHROPIC|GEMINI)"'`;

    const nodeTotal = liveNodes.reduce(
      (sum, row) => sum + Number(row.count),
      0,
    );

    console.log(`Live nodes holding a retired type : ${nodeTotal}`);
    for (const row of liveNodes) {
      console.log(`  ${row.type}: ${Number(row.count)}`);
    }

    console.log(`Active versions referencing one   : ${activeVersions.length}`);
    for (const row of activeVersions) {
      console.log(`  ${row.id}  ${row.name}`);
    }

    if (nodeTotal === 0 && activeVersions.length === 0) {
      console.log(
        `\nCLEAR - nothing in this database references ${RETIRED.join("/")}.`,
      );
      console.log(
        "Repeat against every other environment before relying on it.",
      );
      return;
    }

    console.log(
      "\nNOT CLEAR - deleting these node types breaks the rows listed above.",
    );
    console.log(
      "Those workflows will fail at execution time with UnknownNodeTypeError.",
    );
    console.log(
      "The migration that rewrites them onto AI_LLM was deleted in a4ada53;\n" +
        "restore `src/nodes/ai/legacy-migration.ts` and\n" +
        "`scripts/migrate-legacy-ai-nodes.ts` from that commit's parent, run it,\n" +
        "and re-run this check before shipping the deletion.",
    );
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
