import { readFileSync } from "node:fs";
import path from "node:path";
import { getAuthTables } from "better-auth/db";
import { describe, expect, it } from "vitest";

/**
 * Better Auth writes its own column set; Prisma rejects any field the model
 * does not declare. A Better Auth upgrade that adds a column therefore breaks
 * auth at runtime and not at build time — 1.3 → 1.7 added `account.issuer`,
 * which made sign-up create the user row and then fail on the credential row,
 * leaving accounts that could never log in.
 *
 * This guard compares the canonical table definition against the schema file,
 * so the next such upgrade fails here instead of in production sign-up.
 */
const schema = readFileSync(
  path.join(__dirname, "../../prisma/schema.prisma"),
  "utf8",
);

/** Field names declared on the Prisma model mapped to `@@map("<table>")`. */
function prismaModelFields(table: string): string[] {
  const model = schema
    .split(/^model /m)
    .find((block) => block.includes(`@@map("${table}")`));
  if (!model) throw new Error(`No Prisma model maps to table "${table}"`);

  return model
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("//") && !line.startsWith("@@"))
    .map((line) => line.split(/\s+/)[0])
    .filter(Boolean);
}

// The Polar plugin contributes hooks, not tables, so the core options give the
// same tables the app's `auth` instance builds — without needing its env vars.
const tables = getAuthTables({});

describe("prisma schema covers the Better Auth tables", () => {
  for (const [key, table] of Object.entries(tables)) {
    it(`declares every ${table.modelName} field`, () => {
      const declared = prismaModelFields(table.modelName);
      const expected = Object.values(table.fields).map(
        (field) => field.fieldName ?? key,
      );

      expect(declared).toEqual(expect.arrayContaining(expected));
    });
  }
});
