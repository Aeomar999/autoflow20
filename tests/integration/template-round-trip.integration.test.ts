import { beforeEach, describe, expect, it, vi } from "vitest";
import { templateCatalog } from "@/features/templates/catalog";
import { prepareTemplateGraph } from "@/features/templates/server/instantiate";
import { saveWorkflowInputSchema } from "@/features/workflows/schemas";
import { workflowsRouter } from "@/features/workflows/server/routers";
import prisma from "@/lib/db";
import { outputPorts } from "@/nodes/ports";
import type { createTRPCContext } from "@/trpc/init";

/**
 * AF-M9-15's last acceptance box, as a test rather than a browser check.
 *
 * The box reads: "instantiating each from the gallery produces a workflow that
 * opens in the editor, renders every branch handle, and saves back
 * byte-identically — the G1 round-trip proof." Driving a real browser proves
 * that once, on one machine; this proves it on every run, and it pins the part
 * that actually regressed in G1 — that an edge's persisted `fromOutput` is a
 * port the source node genuinely declares.
 *
 * The path exercised is the real one: `prepareTemplateGraph` (what install
 * does) → `saveWorkflowInputSchema` (the boundary the editor posts through) →
 * `workflows.saveGraph` (validation + persistence) → the `Node`/`Connection`
 * rows the engine later reads.
 */
const hasDb = Boolean(process.env.TEST_DATABASE_URL);

const SLUGS = [
  "api-router-sync-response",
  "multi-channel-broadcast-merge",
  "api-etl-batch-deliver",
] as const;

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: vi
        .fn()
        .mockResolvedValue({ user: { id: "user_rt" }, session: {} }),
    },
  },
}));
vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Map()),
}));

describe.runIf(hasDb)("template round-trip (AF-M9-15 · G1 proof)", () => {
  const caller = workflowsRouter.createCaller(
    {} as unknown as ReturnType<typeof createTRPCContext>,
  );
  let workflowId: string;

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE "organization","member","invitation","workspace","WorkflowVersion","NodeExecution","Execution","Connection","Node","Workflow","Credential","user","session","account","verification" CASCADE`,
    );
    await prisma.user.create({
      data: {
        id: "user_rt",
        email: "rt@test.local",
        name: "RT User",
        emailVerified: true,
      },
    });
    const org = await prisma.organization.create({
      data: {
        name: "RT Workspace",
        slug: "round-trip-integration",
        members: { create: { userId: "user_rt", role: "OWNER" } },
      },
    });
    const wf = await prisma.workflow.create({
      data: {
        name: "Round Trip WF",
        userId: "user_rt",
        organizationId: org.id,
      },
      select: { id: true },
    });
    workflowId = wf.id;
  });

  for (const slug of SLUGS) {
    it(`${slug} installs, saves, and reloads with every port intact`, async () => {
      const spec = templateCatalog.find((t) => t.slug === slug);
      if (!spec) throw new Error(`missing template ${slug}`);

      // 1. Install — exactly what the gallery does.
      const prepared = prepareTemplateGraph(spec.graph);

      // 2. The save boundary. A type missing from `updateNodeSchemas` fails
      //    here, which is how CODE/SPLIT_OUT/AGGREGATE were caught earlier: a
      //    node the editor can place but cannot persist is not shipped.
      const payload = {
        id: workflowId,
        revision: 0,
        nodes: prepared.nodes.map((n) => ({
          id: n.id,
          type: n.type,
          name: n.name ?? n.type,
          position: n.position,
          data: n.data ?? {},
          // `?? undefined`, not `?? null`: the save schema types `notes` as an
          // optional string, and every read path in `workflows/server/routers`
          // normalizes the DB's `null` the same way before it reaches the
          // client. Mirroring that here is what makes this a round-trip of the
          // real contract rather than of a shape nothing produces.
          notes: n.notes ?? undefined,
          disabled: n.disabled ?? false,
        })),
        edges: prepared.edges.map((e) => ({
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle ?? null,
          targetHandle: e.targetHandle ?? null,
        })),
      };
      const parsed = saveWorkflowInputSchema.safeParse(payload);
      expect(
        parsed.success ? [] : parsed.error.issues.map((i) => i.message),
        `${slug} does not satisfy the save boundary`,
      ).toEqual([]);

      // 3. Persist through the real mutation — this also runs `validate()`,
      //    so a graph with a structural error never reaches the assertions.
      await caller.saveGraph(payload);

      // 4. Reload the way the editor and the engine both do.
      const nodes = await prisma.node.findMany({ where: { workflowId } });
      const connections = await prisma.connection.findMany({
        where: { workflowId },
      });

      expect(nodes).toHaveLength(spec.graph.nodes.length);
      expect(connections).toHaveLength(spec.graph.edges.length);

      // Node identity and config survive the round trip.
      const savedByName = new Map(nodes.map((n) => [n.name, n]));
      for (const authored of spec.graph.nodes) {
        const saved = savedByName.get(authored.name ?? authored.type);
        expect(
          saved,
          `${slug}: node "${authored.name}" was not saved`,
        ).toBeDefined();
        expect(saved?.type).toBe(authored.type);
        expect(saved?.data).toEqual(authored.data ?? {});
      }

      // 5. **The G1 proof.** Every persisted edge must name a port its source
      //    node actually declares. Before AF-M9-03 the canvas persisted
      //    `source-1` here, which matched no declared port, so every branching
      //    node marked its whole downstream SKIPPED at run time.
      const typeById = new Map(nodes.map((n) => [n.id, n]));
      for (const conn of connections) {
        const source = typeById.get(conn.fromNodeId);
        expect(source, "edge references an unsaved source node").toBeDefined();
        if (!source) continue;

        const declared = outputPorts(
          source.type,
          source.data as Record<string, unknown>,
        ).map((p) => p.id);

        expect(
          declared,
          `${slug}: edge from "${source.name}" carries port "${conn.fromOutput}", which it does not declare (declares: ${declared.join(", ")})`,
        ).toContain(conn.fromOutput);
      }
    });
  }

  it("preserves a branching node's distinct output ports, not just the first", async () => {
    // W1 is the case that matters: two edges leave the SWITCH on different
    // ports. A regression that collapsed both onto the node's first port would
    // still satisfy the per-edge check above, because "ping" is declared.
    const spec = templateCatalog.find(
      (t) => t.slug === "api-router-sync-response",
    );
    if (!spec) throw new Error("missing W1");

    const prepared = prepareTemplateGraph(spec.graph);
    await caller.saveGraph({
      id: workflowId,
      revision: 0,
      nodes: prepared.nodes.map((n) => ({
        id: n.id,
        type: n.type,
        name: n.name ?? n.type,
        position: n.position,
        data: n.data ?? {},
        notes: n.notes ?? undefined,
        disabled: false,
      })),
      edges: prepared.edges.map((e) => ({
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? null,
        targetHandle: e.targetHandle ?? null,
      })),
    });

    const nodes = await prisma.node.findMany({ where: { workflowId } });
    const switchNode = nodes.find((n) => n.type === "SWITCH");
    expect(switchNode).toBeDefined();

    const outgoing = await prisma.connection.findMany({
      where: { workflowId, fromNodeId: switchNode?.id },
    });
    expect(outgoing).toHaveLength(2);
    expect(outgoing.map((c) => c.fromOutput).sort()).toEqual([
      "ping",
      "process",
    ]);
  });
});
