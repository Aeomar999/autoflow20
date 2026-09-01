import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./src/generated/prisma/client.ts";

const databaseUrl = process.env.DATABASE_URL;
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});
async function main() {
  const result1 =
    await prisma.$queryRaw`SELECT type, count(*) as count FROM "Node" WHERE type IN ('OPENAI', 'ANTHROPIC', 'GEMINI') GROUP BY type;`;
  console.log("Query 1:", result1);

  const result2 =
    await prisma.$queryRaw`SELECT w.id, w.name FROM "Workflow" w JOIN "WorkflowVersion" v ON v.id = w."activeVersionId" WHERE v."graphSnapshot"::text ~ '"type"\s*:\s*"(OPENAI|ANTHROPIC|GEMINI)"';`;
  console.log("Query 2:", result2);
}
main().then(() => process.exit(0));
