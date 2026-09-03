import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { templateCatalog, toSeedRow } from "@/features/templates/catalog";
import type { TemplateGraph } from "@/features/templates/server/instantiate";
import {
  ExecutionStatus,
  NodeExecutionStatus,
  type Prisma,
} from "@/generated/prisma/client";
import prisma from "@/lib/db";
import { runGraph } from "./engine/run-graph";
import { FIXTURE_BASE_URL } from "./fixtures/http-fixture-server";

/**
 * AF-M9-16 — the milestone's definition of done.
 *
 * Not "the plan compiles": the three reference graphs **execute**, from the
 * rows the gallery actually ships, against a local fixture server, with no
 * network access and no credentials.
 *
 * Two properties this suite is built to hold:
 *
 *  1. **It runs the seeded catalogue rows, not inline fixtures.** Each test
 *     projects the catalogue through `toSeedRow` — the exact function
 *     `npm run seed:templates` uses — writes the `Template` row, and reads the
 *     graph back out of the database. A template that drifts from what the
 *     gallery ships therefore breaks this build.
 *
 *  2. **It never touches the public internet.** The only edit made to a
 *     seeded graph is rewriting the two public hostnames the templates call
 *     (`httpbin.org`, `jsonplaceholder.typicode.com`) onto the loopback
 *     fixture from `globalSetup`. That rewrite is asserted to have happened,
 *     so a template that gains a third external host fails loudly here rather
 *     than silently reintroducing a network dependency.
 */
const hasDb = Boolean(process.env.TEST_DATABASE_URL);

/** Hosts the reference templates legitimately call, and their fixture paths. */
const HOST_REWRITES: Array<[string, string]> = [
  ["https://httpbin.org", FIXTURE_BASE_URL],
  ["https://jsonplaceholder.typicode.com", FIXTURE_BASE_URL],
];

/**
 * Point a seeded graph's HTTP endpoints at the fixture.
 *
 * Returns the rewritten graph AND the count of endpoints changed, so a caller
 * can assert the rewrite actually applied — a silent no-op here would mean the
 * test was exercising the public internet without saying so.
 */
function pointAtFixture(graph: TemplateGraph): {
  graph: TemplateGraph;
  rewritten: number;
  externalRemaining: string[];
} {
  let rewritten = 0;
  const externalRemaining: string[] = [];

  const nodes = graph.nodes.map((node) => {
    const endpoint = node.data?.endpoint;
    if (typeof endpoint !== "string") return node;

    let next = endpoint;
    for (const [from, to] of HOST_REWRITES) {
      if (next.startsWith(from)) {
        next = `${to}${next.slice(from.length)}`;
        rewritten += 1;
        break;
      }
    }
    if (next.startsWith("http") && !next.startsWith(FIXTURE_BASE_URL)) {
      externalRemaining.push(next);
    }
    return { ...node, data: { ...node.data, endpoint: next } };
  });

  return { graph: { ...graph, nodes }, rewritten, externalRemaining };
}

/**
 * Seed one catalogue template and hand back its graph **as stored**, pointed
 * at the fixture.
 */
async function seededGraph(slug: string): Promise<TemplateGraph> {
  const spec = templateCatalog.find((t) => t.slug === slug);
  if (!spec) throw new Error(`No catalogue template with slug "${slug}"`);

  const row = toSeedRow(spec);
  await prisma.template.upsert({
    where: { slug: row.slug },
    create: {
      ...row,
      graph: row.graph as unknown as Prisma.InputJsonValue,
    },
    update: {
      ...row,
      graph: row.graph as unknown as Prisma.InputJsonValue,
    },
  });

  // Read back from the DB, not from the in-memory spec: this is what proves
  // the row the gallery serves is the thing that runs.
  const stored = await prisma.template.findUniqueOrThrow({
    where: { slug },
    select: { graph: true },
  });

  const { graph, rewritten, externalRemaining } = pointAtFixture(
    stored.graph as unknown as TemplateGraph,
  );
  expect(
    externalRemaining,
    `${slug} still calls an external host after rewriting`,
  ).toEqual([]);
  expect(rewritten, `${slug} rewrote no endpoints`).toBeGreaterThan(0);

  return graph;
}

/** The shared assertions AF-M9-16 requires of every reference run. */
function assertHealthyRun(
  execution: { status: string; output: unknown; durationMs: number | null },
  nodeExecutions: Array<{ status: string; nodeName: string }>,
) {
  expect(execution.status).toBe(ExecutionStatus.SUCCESS);

  const failed = nodeExecutions.filter(
    (n) => n.status === NodeExecutionStatus.FAILED,
  );
  expect(
    failed.map((n) => n.nodeName),
    "no node may end FAILED",
  ).toEqual([]);

  // AF-M9-05: the enriched view must never be persisted. A `$`-prefixed key in
  // the stored output means the leak came back.
  const output = (execution.output ?? {}) as Record<string, unknown>;
  expect(Object.keys(output).filter((k) => k.startsWith("$"))).toEqual([]);

  expect(execution.durationMs).not.toBeNull();
  expect(execution.durationMs).toBeGreaterThanOrEqual(0);
}

const webhookPayload = (body: unknown) => ({
  webhook: {
    path: "hook",
    method: "POST",
    headers: { "content-type": "application/json" },
    query: {},
    body,
  },
});

describe.skipIf(!hasDb)("AF-M9-16 · reference workflows execute", () => {
  beforeAll(async () => {
    // The fixture is started by globalSetup; fail fast and legibly if it is
    // not reachable rather than letting every case fail as an egress error.
    const res = await fetch(`${FIXTURE_BASE_URL}/posts`);
    expect(res.status, "fixture server is not reachable").toBe(200);
  });

  beforeEach(async () => {
    await prisma.nodeExecution.deleteMany({});
    await prisma.execution.deleteMany({});
  });

  // -------------------------------------------------------------------------
  // W1 — route: sync API endpoint, n-way switch, per-branch work, one response
  // -------------------------------------------------------------------------

  describe("W1 · api-router-sync-response", () => {
    it('action "ping" responds 200 pong and SKIPS the process branch', async () => {
      const graph = await seededGraph("api-router-sync-response");

      const { execution, nodeExecutions } = await runGraph(graph, {
        initialData: webhookPayload({ action: "ping" }),
      });

      assertHealthyRun(execution, nodeExecutions);

      expect(execution.response).toEqual({
        statusCode: 200,
        contentType: "application/json",
        headers: {},
        body: expect.any(String),
      });
      const body = JSON.parse(
        (execution.response as { body: string }).body,
      ) as Record<string, unknown>;
      expect(body.ok).toBe(true);
      expect(body.message).toBe("pong");

      const byName = new Map(nodeExecutions.map((n) => [n.nodeName, n.status]));
      expect(byName.get("Compose ping")).toBe(NodeExecutionStatus.SUCCESS);
      // The whole `process` branch must be SKIPPED, not merely absent.
      expect(byName.get("Service A")).toBe(NodeExecutionStatus.SKIPPED);
      expect(byName.get("Compose result")).toBe(NodeExecutionStatus.SKIPPED);
    });

    it('action "process" calls the service and responds with its data', async () => {
      const graph = await seededGraph("api-router-sync-response");

      const { execution, nodeExecutions } = await runGraph(graph, {
        initialData: webhookPayload({
          action: "process",
          payload: { hello: "world", n: 7 },
        }),
      });

      assertHealthyRun(execution, nodeExecutions);

      const body = JSON.parse(
        (execution.response as { body: string }).body,
      ) as Record<string, unknown>;
      expect(body.ok).toBe(true);
      expect(body.source).toBe("serviceA");
      // Proves the request body really reached the service and came back —
      // the fixture echoes the posted JSON under `json`.
      expect(body.data).toEqual({ hello: "world", n: 7 });

      const byName = new Map(nodeExecutions.map((n) => [n.nodeName, n.status]));
      expect(byName.get("Service A")).toBe(NodeExecutionStatus.SUCCESS);
      expect(byName.get("Compose ping")).toBe(NodeExecutionStatus.SKIPPED);
    });

    it("an unknown action ends SUCCESS with everything after the switch SKIPPED", async () => {
      const graph = await seededGraph("api-router-sync-response");

      const { execution, nodeExecutions } = await runGraph(graph, {
        initialData: webhookPayload({ action: "not-a-real-action" }),
      });

      assertHealthyRun(execution, nodeExecutions);

      const byName = new Map(nodeExecutions.map((n) => [n.nodeName, n.status]));
      expect(byName.get("Route by action")).toBe(NodeExecutionStatus.SUCCESS);
      for (const downstream of [
        "Compose ping",
        "Service A",
        "Compose result",
        "Respond",
      ]) {
        expect(byName.get(downstream), downstream).toBe(
          NodeExecutionStatus.SKIPPED,
        );
      }

      // No respond node ran, so the route keeps the legacy envelope — the
      // AF-M9-10 fallback, asserted here at the data layer.
      expect(execution.response).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // W2 — fan-out / merge: deliver to N channels, consolidate, respond
  // -------------------------------------------------------------------------

  describe("W2 · multi-channel-broadcast-merge", () => {
    it("runs both broadcasts, merges by input port, and responds with both", async () => {
      const graph = await seededGraph("multi-channel-broadcast-merge");

      const { execution, nodeExecutions } = await runGraph(graph, {
        initialData: webhookPayload({ message: "ship it" }),
      });

      assertHealthyRun(execution, nodeExecutions);

      const byName = new Map(nodeExecutions.map((n) => [n.nodeName, n.status]));
      expect(byName.get("Broadcast A")).toBe(NodeExecutionStatus.SUCCESS);
      expect(byName.get("Broadcast B")).toBe(NodeExecutionStatus.SUCCESS);

      const body = JSON.parse(
        (execution.response as { body: string }).body,
      ) as Record<string, unknown>;

      // AF-M9-11: each branch under its own key, in declared port order. This
      // is the assertion that fails if MERGE regresses to a single input.
      expect(body).toHaveProperty("input0");
      expect(body).toHaveProperty("input1");

      const channelOf = (input: unknown) =>
        (
          (
            input as {
              respA?: { httpResponse?: { data?: { json?: unknown } } };
            }
          )?.respA ??
          (
            input as {
              respB?: { httpResponse?: { data?: { json?: unknown } } };
            }
          )?.respB
        )?.httpResponse?.data?.json as { channel?: string } | undefined;

      expect(channelOf(body.input0)?.channel).toBe("alpha");
      expect(channelOf(body.input1)?.channel).toBe("beta");
    });

    it("a failing broadcast under continueOnFail still returns 200", async () => {
      // The only mutation this suite makes beyond the host rewrite, and it is
      // the point of the case: Broadcast B is pointed at the fixture's
      // deterministic 500 and allowed to fail, proving one dead channel does
      // not take the caller's response down with it.
      const base = await seededGraph("multi-channel-broadcast-merge");
      const graph: TemplateGraph = {
        ...base,
        nodes: base.nodes.map((node) =>
          node.name === "Broadcast B"
            ? {
                ...node,
                data: {
                  ...node.data,
                  endpoint: `${FIXTURE_BASE_URL}/fail`,
                  _run: { maxAttempts: 1, continueOnFail: true },
                },
              }
            : node,
        ),
      };

      const { execution, nodeExecutions } = await runGraph(graph, {
        initialData: webhookPayload({ message: "half broken" }),
      });

      expect(execution.status).toBe(ExecutionStatus.SUCCESS);

      const byName = new Map(nodeExecutions.map((n) => [n.nodeName, n.status]));
      expect(byName.get("Broadcast A")).toBe(NodeExecutionStatus.SUCCESS);
      expect(byName.get("Broadcast B")).toBe(NodeExecutionStatus.FAILED);

      // The caller still gets a real response.
      expect((execution.response as { statusCode: number }).statusCode).toBe(
        200,
      );

      const body = JSON.parse(
        (execution.response as { body: string }).body,
      ) as Record<string, unknown>;
      expect(body).toHaveProperty("input0");
      expect(body).toHaveProperty("input1");
      // The failed branch contributes nothing rather than a partial object.
      expect(body.input1).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // W3 — ETL fan-out: pull a collection, transform, write one row per item
  // -------------------------------------------------------------------------

  describe("W3 · api-etl-batch-deliver", () => {
    it("delivers 10 records individually and aggregates the outcome", async () => {
      const graph = await seededGraph("api-etl-batch-deliver");

      const { execution, nodeExecutions } = await runGraph(graph);

      assertHealthyRun(execution, nodeExecutions);

      // AF-M9-14: one trace row per item for the interior node, keyed by
      // itemIndex 0..9 — the fan-out actually fanned out.
      const deliveries = nodeExecutions.filter((n) => n.nodeName === "Deliver");
      expect(deliveries).toHaveLength(10);
      expect(
        deliveries.map((n) => n.itemIndex).sort((a, b) => (a ?? 0) - (b ?? 0)),
      ).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
      for (const row of deliveries) {
        expect(row.status).toBe(NodeExecutionStatus.SUCCESS);
      }

      const output = execution.output as Record<string, unknown>;
      expect(output.count).toBe(10);
      expect(output.failed).toEqual([]);
      expect(Array.isArray(output.items)).toBe(true);
      expect((output.items as unknown[]).length).toBe(10);

      // W3 ships in the FULL fan-out form, not the §1 batched fallback. If
      // someone quietly substitutes one batched POST, `deliveries` above drops
      // to 1 and this suite fails — which is exactly what the task asked for.
      const byName = new Map(nodeExecutions.map((n) => [n.nodeName, n.status]));
      expect(byName.get("Fan out")).toBe(NodeExecutionStatus.SUCCESS);
      expect(byName.get("Collect")).toBe(NodeExecutionStatus.SUCCESS);
    });
  });
});
