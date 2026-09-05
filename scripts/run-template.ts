/**
 * Install a catalogue template and execute it for real (AF-M10-34 staging).
 *
 * This is the production path, not a test harness: it writes a real Workflow,
 * binds real credentials, and sends the same `workflows/execute.workflow`
 * event the Run button sends, so the Inngest dev server runs the same function
 * a deployed run would. The only thing skipped is the browser click.
 *
 *   npx dotenv -e .env -- npx tsx scripts/run-template.ts <slug> [inputJson]
 *
 * Credentials are bound by matching each node's declared requirement against
 * the credentials already connected in the org. A requirement with no match is
 * reported and left unbound, so the run fails with the provider's own error
 * rather than this script inventing a secret.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { templateCatalog } from "../src/features/templates/catalog/index";
import { prepareTemplateGraph } from "../src/features/templates/server/instantiate";
import { PrismaClient } from "../src/generated/prisma/client";
import { nodeRegistry } from "../src/nodes/registry";

const slug = process.argv[2];
const inputJson = process.argv[3];

if (!slug) {
  console.error("usage: run-template.ts <slug> [inputJson]");
  process.exit(1);
}

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  const spec = templateCatalog.find((t) => t.slug === slug);
  if (!spec) throw new Error(`no template with slug "${slug}"`);

  // The org that actually holds credentials, so a run is not blocked by
  // picking the empty one.
  const orgs = await prisma.organization.findMany({
    select: {
      id: true,
      name: true,
      credentials: { select: { id: true, type: true, name: true } },
      members: { select: { userId: true }, take: 1 },
    },
  });
  const org =
    orgs.sort((a, b) => b.credentials.length - a.credentials.length)[0] ?? null;
  if (!org) throw new Error("no organization in this database");
  const userId = org.members[0]?.userId;
  if (!userId) throw new Error(`organization ${org.name} has no members`);

  console.log(
    `org: ${org.name}  credentials: ${org.credentials.map((c) => c.type).join(", ") || "none"}`,
  );

  const prepared = prepareTemplateGraph(spec.graph);

  // Bind what we can. A credential requirement is a `type` string that may
  // offer alternatives separated by "|", e.g. "google.sheets|google.oauth2".
  const bound: string[] = [];
  const missing: string[] = [];

  for (const node of prepared.nodes) {
    const registration = nodeRegistry.resolve(node.type);
    for (const requirement of registration.credentials ?? []) {
      const accepted = requirement.type.split("|");
      const match = org.credentials.find((c) => accepted.includes(c.type));
      if (match) {
        node.data ??= {};
        node.data[requirement.key] = match.id;
        bound.push(
          `${node.name ?? node.type}.${requirement.key} -> ${match.type}`,
        );
      } else if (requirement.required) {
        missing.push(
          `${node.name ?? node.type}.${requirement.key} needs ${requirement.type}`,
        );
      }
    }
  }

  console.log(`\nbound ${bound.length} credential field(s):`);
  for (const b of bound) console.log(`  ${b}`);
  if (missing.length > 0) {
    console.log(`\nMISSING ${missing.length} required credential(s):`);
    for (const m of missing) console.log(`  ${m}`);
  }
  if (prepared.pendingSetup.length > 0) {
    const values = [
      ...new Set(prepared.pendingSetup.map((v) => v.placeholder)),
    ];
    console.log(`\npending setup values still unfilled: ${values.join(", ")}`);
  }

  const workflow = await prisma.$transaction(async (tx) => {
    const created = await tx.workflow.create({
      data: {
        name: `${spec.name} (staging run)`,
        userId,
        organizationId: org.id,
      },
    });
    await tx.node.createMany({
      data: prepared.nodes.map((n) => ({
        id: n.id,
        workflowId: created.id,
        name: n.name ?? n.type,
        type: n.type,
        position: n.position,
        data: (n.data ?? {}) as never,
        notes: n.notes ?? null,
        disabled: n.disabled ?? false,
      })),
    });
    const ids = new Set(prepared.nodes.map((n) => n.id));
    const edges = prepared.edges.filter(
      (e) => ids.has(e.source) && ids.has(e.target),
    );
    if (edges.length > 0) {
      await tx.connection.createMany({
        data: edges.map((e) => ({
          workflowId: created.id,
          fromNodeId: e.source,
          toNodeId: e.target,
          fromOutput: e.sourceHandle ?? "main",
          toInput: e.targetHandle ?? "main",
        })),
      });
    }
    return created;
  });

  console.log(
    `\nworkflow ${workflow.id} created with ${prepared.nodes.length} nodes`,
  );

  const initialData = inputJson ? JSON.parse(inputJson) : undefined;

  // Exactly the payload `sendWorkflowExecution` builds, so this exercises the
  // real wiring rather than a shape invented here.
  const body = {
    name: "workflows/execute.workflow",
    data: {
      workflowId: workflow.id,
      userId,
      organizationId: org.id,
      ...(initialData ?? {}),
    },
  };

  const res = await fetch(
    `http://127.0.0.1:8288/e/${process.env.INNGEST_EVENT_KEY || "dev"}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  console.log(`event sent: ${res.status} ${await res.text()}`);

  // Poll for the execution this event created.
  const deadline = Date.now() + 120_000;
  let last = "";
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const execution = await prisma.execution.findFirst({
      where: { workflowId: workflow.id },
      orderBy: { startedAt: "desc" },
      include: {
        nodeExecutions: { orderBy: { order: "asc" } },
      },
    });
    if (!execution) continue;
    if (execution.status !== last) {
      console.log(`execution ${execution.id}: ${execution.status}`);
      last = execution.status;
    }
    if (["SUCCESS", "FAILED", "CANCELLED"].includes(execution.status)) {
      console.log(`\n--- node trace (${execution.nodeExecutions.length}) ---`);
      for (const ne of execution.nodeExecutions) {
        console.log(
          `  ${String(ne.order).padStart(2)}  ${ne.status.padEnd(9)} ${ne.nodeType}` +
            (ne.error
              ? `\n        error: ${String(ne.error).slice(0, 300)}`
              : ""),
        );
        if (ne.output) {
          console.log(
            `        output: ${JSON.stringify(ne.output).slice(0, 400)}`,
          );
        }
      }
      break;
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
