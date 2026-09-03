import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import prisma from "@/lib/db";

/**
 * AF-M9-03: the data migration that rewrites the pre-port-aware canvas handles
 * (`source-1` / `target-1`) onto the nodes' declared `PortDef.id`s.
 *
 * Runs the **shipped migration file** rather than a copy of its logic — a test
 * that re-implemented the SQL would pass while the deployed file was wrong.
 * The file has already been applied once by `prisma migrate deploy`, so every
 * run here is also the idempotency check the acceptance criteria call for.
 */
const dbUrl = process.env.TEST_DATABASE_URL;
const hasDb = Boolean(dbUrl);

const MIGRATION_SQL = readFileSync(
  join(
    process.cwd(),
    "prisma/migrations/20260902120000_declared_port_ids/migration.sql",
  ),
  "utf8",
);

const TRUNCATE = `TRUNCATE TABLE "organization","member","invitation","workspace","WorkflowVersion","NodeExecution","Execution","Connection","Node","Workflow","Credential","user","session","account","verification" CASCADE`;

describe.runIf(hasDb)("AF-M9-03 declared-port-id migration", () => {
  // node-postgres, not Prisma: the file is multi-statement and ends in a
  // DO $$ … $$ block, which `$executeRawUnsafe` will not run as one unit.
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString: dbUrl });
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(TRUNCATE);
  });

  /** Minimal tenant + workflow the Connection rows can hang off. */
  async function seedWorkflow(): Promise<string> {
    const userId = `user-portmig-${Date.now()}`;
    await prisma.user.create({
      data: { id: userId, name: "Port Mig", email: `${userId}@test.local` },
    });
    const org = await prisma.organization.create({
      data: {
        name: "Port Mig",
        slug: `portmig-${Date.now()}`,
        members: { create: { userId, role: "OWNER" } },
      },
      select: { id: true },
    });
    const wf = await prisma.workflow.create({
      data: { name: "portmig", userId, organizationId: org.id },
      select: { id: true },
    });
    return wf.id;
  }

  async function seedNode(workflowId: string, id: string, type: string) {
    await prisma.node.create({
      data: { id, workflowId, name: id, type, position: { x: 0, y: 0 } },
    });
  }

  const runMigration = () => client.query(MIGRATION_SQL);

  it("rewrites a non-branching node's legacy handles onto 'main'", async () => {
    const workflowId = await seedWorkflow();
    await seedNode(workflowId, "n-trig", "MANUAL_TRIGGER");
    await seedNode(workflowId, "n-http", "HTTP_REQUEST");
    await prisma.connection.create({
      data: {
        workflowId,
        fromNodeId: "n-trig",
        toNodeId: "n-http",
        fromOutput: "source-1",
        toInput: "target-1",
      },
    });

    await runMigration();

    const row = await prisma.connection.findFirstOrThrow({
      where: { workflowId },
    });
    expect(row.fromOutput).toBe("main");
    expect(row.toInput).toBe("main");
  });

  it("maps a CONDITION's single legacy edge onto its first declared output", async () => {
    // This is the whole point: before the migration this edge could never be
    // marked taken, so everything after the condition was SKIPPED.
    const workflowId = await seedWorkflow();
    await seedNode(workflowId, "c-cond", "CONDITION");
    await seedNode(workflowId, "c-next", "SET");
    await prisma.connection.create({
      data: {
        workflowId,
        fromNodeId: "c-cond",
        toNodeId: "c-next",
        fromOutput: "source-1",
        toInput: "target-1",
      },
    });

    await runMigration();

    const row = await prisma.connection.findFirstOrThrow({
      where: { workflowId },
    });
    expect(row.fromOutput).toBe("true");
    expect(row.toInput).toBe("main");
  });

  it("leaves an ambiguous CONDITION (two legacy edges) untouched", async () => {
    // Both were drawn from the same rendered handle, so nothing recorded which
    // was meant to be the false branch. Rewriting both to "true" would invent a
    // graph the author never drew and make the run take both paths.
    const workflowId = await seedWorkflow();
    await seedNode(workflowId, "a-cond", "CONDITION");
    await seedNode(workflowId, "a-yes", "SET");
    await seedNode(workflowId, "a-no", "SET");
    await prisma.connection.createMany({
      data: [
        {
          workflowId,
          fromNodeId: "a-cond",
          toNodeId: "a-yes",
          fromOutput: "source-1",
          toInput: "target-1",
        },
        {
          workflowId,
          fromNodeId: "a-cond",
          toNodeId: "a-no",
          fromOutput: "source-1",
          toInput: "target-1",
        },
      ],
    });

    await runMigration();

    const rows = await prisma.connection.findMany({ where: { workflowId } });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.fromOutput).toBe("source-1");
      // Inputs are unambiguous and are still repaired.
      expect(row.toInput).toBe("main");
    }
  });

  it("never touches an already-declared port id", async () => {
    // Catalogue templates author sourceHandle "false" by hand; a migration that
    // "helpfully" normalised them would silently move the branch.
    const workflowId = await seedWorkflow();
    await seedNode(workflowId, "k-cond", "CONDITION");
    await seedNode(workflowId, "k-no", "SET");
    await prisma.connection.create({
      data: {
        workflowId,
        fromNodeId: "k-cond",
        toNodeId: "k-no",
        fromOutput: "false",
        toInput: "main",
      },
    });

    await runMigration();

    const row = await prisma.connection.findFirstOrThrow({
      where: { workflowId },
    });
    expect(row.fromOutput).toBe("false");
    expect(row.toInput).toBe("main");
  });

  it("is idempotent — a second run changes nothing", async () => {
    const workflowId = await seedWorkflow();
    await seedNode(workflowId, "i-cond", "CONDITION");
    await seedNode(workflowId, "i-next", "SET");
    await prisma.connection.create({
      data: {
        workflowId,
        fromNodeId: "i-cond",
        toNodeId: "i-next",
        fromOutput: "source-1",
        toInput: "target-1",
      },
    });

    await runMigration();
    const afterFirst = await prisma.connection.findMany({
      where: { workflowId },
      orderBy: { id: "asc" },
    });

    await runMigration();
    const afterSecond = await prisma.connection.findMany({
      where: { workflowId },
      orderBy: { id: "asc" },
    });

    expect(afterSecond).toEqual(afterFirst);
  });

  it("repairs a node whose type is no longer in the manifest", async () => {
    // The AF-M8-12 retired AI types can still own rows; 'main' is the right
    // fallback and the migration must not skip them.
    const workflowId = await seedWorkflow();
    await seedNode(workflowId, "g-old", "ANTHROPIC");
    await seedNode(workflowId, "g-next", "SET");
    await prisma.connection.create({
      data: {
        workflowId,
        fromNodeId: "g-old",
        toNodeId: "g-next",
        fromOutput: "source-1",
        toInput: "target-1",
      },
    });

    await runMigration();

    const row = await prisma.connection.findFirstOrThrow({
      where: { workflowId },
    });
    expect(row.fromOutput).toBe("main");
    expect(row.toInput).toBe("main");
  });
});
