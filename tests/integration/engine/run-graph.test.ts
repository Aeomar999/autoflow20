import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { TemplateGraph } from "@/features/templates/server/instantiate";
import {
  ExecutionStatus,
  NodeExecutionStatus,
} from "@/generated/prisma/client";
import { MAX_NODE_OUTPUT_BYTES, serializedBytes } from "@/inngest/config";
import prisma from "@/lib/db";
import { runGraph } from "./run-graph";

/**
 * AF-M9-01: Engine execution integration tests.
 *
 * Proves the execution engine runs graphs against real Postgres by seeding
 * fixture rows and driving `executeWorkflowHandler` directly (no Inngest
 * dev server). `step` is faked with a memoless `run` that executes each
 * callback inline — no replay, no memoisation.
 */
const dbUrl = process.env.TEST_DATABASE_URL;
const hasDb = Boolean(dbUrl);

const TRUNCATE = `TRUNCATE TABLE "organization","member","invitation","workspace","WorkflowVersion","NodeExecution","Execution","Connection","Node","Workflow","Credential","user","session","account","verification" CASCADE`;

describe.runIf(hasDb)("Engine execution integration (AF-M9-01)", () => {
  beforeAll(() => {
    process.env.E2E_SERVER = "1";
  });

  afterAll(() => {
    delete process.env.E2E_SERVER;
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(TRUNCATE);
  });

  // ------------------------------------------------------------------
  // Suite 1 — Linear 3-node graph succeeds end-to-end
  // ------------------------------------------------------------------
  describe("linear 3-node graph", () => {
    it("Trigger → Set → Done all SUCCESS; execution ends SUCCESS", async () => {
      const graph: TemplateGraph = {
        nodes: [
          {
            id: "trigger-1",
            name: "Trigger",
            type: "MANUAL_TRIGGER",
            position: { x: 0, y: 0 },
            data: { _run: { timeoutMs: 1000 } },
          },
          {
            id: "set-1",
            name: "Set",
            type: "SET",
            position: { x: 0, y: 0 },
            data: { mappings: [], _run: { timeoutMs: 1000 } },
          },
          {
            id: "done-1",
            name: "Done",
            type: "SET",
            position: { x: 0, y: 0 },
            data: { mappings: [], _run: { timeoutMs: 1000 } },
          },
        ],
        edges: [
          {
            source: "trigger-1",
            target: "set-1",
            sourceHandle: "main",
            targetHandle: "main",
          },
          {
            source: "set-1",
            target: "done-1",
            sourceHandle: "main",
            targetHandle: "main",
          },
        ],
      };

      const { execution, nodeExecutions } = await runGraph(graph);

      expect(execution.status).toBe(ExecutionStatus.SUCCESS);

      expect(nodeExecutions).toHaveLength(3);
      for (const ne of nodeExecutions) {
        expect(ne.status).toBe(NodeExecutionStatus.SUCCESS);
      }
    });
  });

  // ------------------------------------------------------------------
  // Suite 2 — Failing node blocks downstream
  // ------------------------------------------------------------------
  describe("failing node blocks downstream", () => {
    it("CONDITION without operator throws; downstream node is SKIPPED", async () => {
      const graph: TemplateGraph = {
        nodes: [
          {
            id: "trigger-2",
            name: "Trigger",
            type: "MANUAL_TRIGGER",
            position: { x: 0, y: 0 },
            data: { _run: { timeoutMs: 1000 } },
          },
          {
            id: "cond-fail",
            name: "CondNoOp",
            type: "CONDITION",
            position: { x: 0, y: 0 },
            data: { _run: { timeoutMs: 1000 } },
          },
          {
            id: "done-2",
            name: "Done",
            type: "SET",
            position: { x: 0, y: 0 },
            data: { mappings: [], _run: { timeoutMs: 1000 } },
          },
        ],
        edges: [
          {
            source: "trigger-2",
            target: "cond-fail",
            sourceHandle: "main",
            targetHandle: "main",
          },
          {
            source: "cond-fail",
            target: "done-2",
            sourceHandle: "true",
            targetHandle: "main",
          },
        ],
      };

      let threw = false;
      try {
        await runGraph(graph);
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);

      const nodes = await prisma.nodeExecution.findMany({
        orderBy: { order: "asc" },
      });
      const condition = nodes.find((n) => n.nodeName === "CondNoOp");
      expect(condition?.status).toBe(NodeExecutionStatus.FAILED);
      expect(condition?.error).toMatch(/operator is required/);

      const done = nodes.find((n) => n.nodeName === "Done");
      expect(done?.status).toBe(NodeExecutionStatus.SKIPPED);
      expect(done?.skipReason).toBe("Skipped: an upstream node failed");
    });
  });

  // ------------------------------------------------------------------
  // Suite 3 — Quota exceeded
  // ------------------------------------------------------------------
  describe("quota exceeded", () => {
    it("PRODUCTION mode with 100 countable executions → QUOTA_EXCEEDED, no node traces", async () => {
      const userId = "user-quota";
      await prisma.user.create({
        data: { id: userId, name: "Quota User", email: "quota@test.local" },
      });
      const org = await prisma.organization.create({
        data: {
          name: "Quota Org",
          slug: "quota-org",
          members: { create: { userId, role: "OWNER" } },
        },
        select: { id: true },
      });
      const organizationId = org.id;
      const workflow = await prisma.workflow.create({
        data: { name: "quota-wf", userId, organizationId },
        select: { id: true },
      });
      const workflowId = workflow.id;

      const monthStart = new Date();
      monthStart.setUTCDate(1);
      monthStart.setUTCHours(0, 0, 0, 0);

      const countableStatuses = [
        "SUCCESS",
        "FAILED",
        "CANCELLED",
        "TIMED_OUT",
      ] as const;

      // Seed exactly 100 countable executions (FREE plan limit = 100).
      await prisma.execution.createMany({
        data: Array.from({ length: 100 }, (_, i) => ({
          workflowId,
          inngestEventId: `evt-prior-${i}`,
          trigger: "MANUAL",
          mode: "PRODUCTION",
          status: countableStatuses[i % countableStatuses.length],
          organizationId,
          startedAt: new Date(monthStart.getTime() + i * 1000),
        })),
      });

      const graph: TemplateGraph = {
        nodes: [
          {
            id: "trigger-q",
            name: "Trigger",
            type: "MANUAL_TRIGGER",
            position: { x: 0, y: 0 },
            data: { _run: { timeoutMs: 1000 } },
          },
        ],
        edges: [],
      };

      // The global E2E_SERVER=1 bypass would silently skip the quota gate;
      // unset it for this run so the gate actually evaluates and refuses.
      const e2e = process.env.E2E_SERVER;
      delete process.env.E2E_SERVER;
      type RunGraphResult = Awaited<ReturnType<typeof runGraph>>;
      let execution: RunGraphResult["execution"];
      let nodeExecutions: RunGraphResult["nodeExecutions"];
      try {
        ({ execution, nodeExecutions } = await runGraph(graph, {
          mode: "PRODUCTION",
          orgId: organizationId,
          userId,
          workflowId,
        }));
      } finally {
        if (e2e !== undefined) process.env.E2E_SERVER = e2e;
      }

      expect(execution.status).toBe(ExecutionStatus.QUOTA_EXCEEDED);
      expect(execution.error).toMatch(/quota exceeded/i);
      expect(nodeExecutions).toHaveLength(0);
    });
  });

  // ------------------------------------------------------------------
  // Suite 4 — CONDITION regression: G1 bug (editor-style edge ids)
  // ------------------------------------------------------------------
  describe("CONDITION branch routing (G1, fixed by AF-M9-03)", () => {
    it("editor-style edge ids resolve onto declared ports, so the taken branch runs", async () => {
      const graph: TemplateGraph = {
        nodes: [
          {
            id: "trigger-g1",
            name: "Trigger",
            type: "MANUAL_TRIGGER",
            position: { x: 0, y: 0 },
            data: { _run: { timeoutMs: 1000 } },
          },
          {
            id: "cond-g1",
            name: "Cond",
            type: "CONDITION",
            position: { x: 0, y: 0 },
            data: {
              left: "trigger",
              operator: "equals",
              right: "trigger",
              _run: { timeoutMs: 1000 },
            },
          },
          {
            id: "done-g1",
            name: "Done",
            type: "SET",
            position: { x: 0, y: 0 },
            data: { mappings: [], _run: { timeoutMs: 1000 } },
          },
        ],
        edges: [
          // Canvas-style edges use `source-1` instead of `true`/`false`.
          {
            source: "trigger-g1",
            target: "cond-g1",
            sourceHandle: "main",
            targetHandle: "main",
          },
          {
            source: "cond-g1",
            target: "done-g1",
            sourceHandle: "source-1",
            targetHandle: "main",
          },
        ],
      };

      const { execution, nodeExecutions } = await runGraph(graph);

      // Before AF-M9-03 the canvas persisted its hardcoded "source-1" handle as
      // `fromOutput`, so `markTakenEdges` compared it against the CONDITION's
      // `_outputPort` of "true", never matched, and marked the whole downstream
      // SKIPPED. `resolveEdgePorts` now maps "source-1" onto the node's first
      // declared output ("true"), so the affirmative branch actually runs.
      const condition = nodeExecutions.find((n) => n.nodeName === "Cond");
      expect(condition?.status).toBe(NodeExecutionStatus.SUCCESS);

      const done = nodeExecutions.find((n) => n.nodeName === "Done");
      expect(done?.status).toBe(NodeExecutionStatus.SUCCESS);
      expect(done?.skipReason).toBeNull();

      expect(execution.status).toBe(ExecutionStatus.SUCCESS);
    });

    it("routes to exactly one branch: the untaken side is SKIPPED with a reason", async () => {
      // The other half of G1 — a fix that ran BOTH branches would be just as
      // wrong as one that ran neither, and the old assertion could not tell.
      const graph: TemplateGraph = {
        nodes: [
          {
            id: "trigger-b",
            name: "Trigger",
            type: "MANUAL_TRIGGER",
            position: { x: 0, y: 0 },
            data: { _run: { timeoutMs: 1000 } },
          },
          {
            id: "cond-b",
            name: "Cond",
            type: "CONDITION",
            position: { x: 0, y: 0 },
            data: {
              left: "a",
              operator: "equals",
              right: "a",
              _run: { timeoutMs: 1000 },
            },
          },
          {
            id: "yes-b",
            name: "Yes",
            type: "SET",
            position: { x: 0, y: 0 },
            data: { mappings: [], _run: { timeoutMs: 1000 } },
          },
          {
            id: "no-b",
            name: "No",
            type: "SET",
            position: { x: 0, y: 0 },
            data: { mappings: [], _run: { timeoutMs: 1000 } },
          },
        ],
        edges: [
          { source: "trigger-b", target: "cond-b", sourceHandle: "main" },
          { source: "cond-b", target: "yes-b", sourceHandle: "true" },
          { source: "cond-b", target: "no-b", sourceHandle: "false" },
        ],
      };

      const { execution, nodeExecutions } = await runGraph(graph);

      expect(nodeExecutions.find((n) => n.nodeName === "Yes")?.status).toBe(
        NodeExecutionStatus.SUCCESS,
      );

      const no = nodeExecutions.find((n) => n.nodeName === "No");
      expect(no?.status).toBe(NodeExecutionStatus.SKIPPED);
      expect(no?.skipReason).toBe("Skipped: not reachable via taken branches");

      expect(execution.status).toBe(ExecutionStatus.SUCCESS);
    });

    it("takes the false branch when the condition does not hold", async () => {
      const graph: TemplateGraph = {
        nodes: [
          {
            id: "trigger-f",
            name: "Trigger",
            type: "MANUAL_TRIGGER",
            position: { x: 0, y: 0 },
            data: { _run: { timeoutMs: 1000 } },
          },
          {
            id: "cond-f",
            name: "Cond",
            type: "CONDITION",
            position: { x: 0, y: 0 },
            data: {
              left: "a",
              operator: "equals",
              right: "b",
              _run: { timeoutMs: 1000 },
            },
          },
          {
            id: "yes-f",
            name: "Yes",
            type: "SET",
            position: { x: 0, y: 0 },
            data: { mappings: [], _run: { timeoutMs: 1000 } },
          },
          {
            id: "no-f",
            name: "No",
            type: "SET",
            position: { x: 0, y: 0 },
            data: { mappings: [], _run: { timeoutMs: 1000 } },
          },
        ],
        edges: [
          { source: "trigger-f", target: "cond-f", sourceHandle: "main" },
          { source: "cond-f", target: "yes-f", sourceHandle: "true" },
          { source: "cond-f", target: "no-f", sourceHandle: "false" },
        ],
      };

      const { nodeExecutions } = await runGraph(graph);

      expect(nodeExecutions.find((n) => n.nodeName === "No")?.status).toBe(
        NodeExecutionStatus.SUCCESS,
      );
      expect(nodeExecutions.find((n) => n.nodeName === "Yes")?.status).toBe(
        NodeExecutionStatus.SKIPPED,
      );
    });
  });

  // ------------------------------------------------------------------
  // Suite 5 — Node.disabled (AF-M9-04, gap G10)
  // ------------------------------------------------------------------
  describe("disabled nodes", () => {
    it("skips a disabled middle node and passes its input through", async () => {
      // The editor has shipped an "Enabled" toggle since M1 and `saveGraph`
      // has always persisted it; the engine ignored the column entirely, so
      // disabling a node did nothing at run time.
      const graph: TemplateGraph = {
        nodes: [
          {
            id: "trigger-d",
            name: "Trigger",
            type: "MANUAL_TRIGGER",
            position: { x: 0, y: 0 },
            data: { _run: { timeoutMs: 1000 } },
          },
          {
            id: "seed-d",
            name: "Seed",
            type: "SET",
            position: { x: 0, y: 0 },
            data: {
              mappings: [{ key: "marker", value: "from-upstream" }],
              _run: { timeoutMs: 1000 },
            },
          },
          {
            id: "off-d",
            name: "Off",
            type: "SET",
            position: { x: 0, y: 0 },
            disabled: true,
            // Would overwrite `marker` if it ran — that is the assertion.
            data: {
              mappings: [{ key: "marker", value: "from-disabled" }],
              _run: { timeoutMs: 1000 },
            },
          },
          {
            id: "done-d",
            name: "Done",
            type: "SET",
            position: { x: 0, y: 0 },
            data: { mappings: [], _run: { timeoutMs: 1000 } },
          },
        ],
        edges: [
          { source: "trigger-d", target: "seed-d", sourceHandle: "main" },
          { source: "seed-d", target: "off-d", sourceHandle: "main" },
          { source: "off-d", target: "done-d", sourceHandle: "main" },
        ],
      };

      const { execution, nodeExecutions } = await runGraph(graph);

      expect(execution.status).toBe(ExecutionStatus.SUCCESS);

      // Skipped VISIBLY — a node missing from the trace is indistinguishable
      // from one that never existed.
      const off = nodeExecutions.find((n) => n.nodeName === "Off");
      expect(off?.status).toBe(NodeExecutionStatus.SKIPPED);
      expect(off?.skipReason).toBe("Skipped: node is disabled");

      // Pass-through: the branch is not severed and Done still runs.
      const done = nodeExecutions.find((n) => n.nodeName === "Done");
      expect(done?.status).toBe(NodeExecutionStatus.SUCCESS);

      // Done received the UPSTREAM payload, not the disabled node's.
      expect((execution.output as Record<string, unknown> | null)?.marker).toBe(
        "from-upstream",
      );

      // Every node is present in the trace exactly once.
      expect(nodeExecutions).toHaveLength(4);
    });

    it("does not run a disabled node's executor at all", async () => {
      // A disabled node whose config could not possibly execute: if the engine
      // still ran it, this would fail the run instead of skipping it.
      const graph: TemplateGraph = {
        nodes: [
          {
            id: "trigger-x",
            name: "Trigger",
            type: "MANUAL_TRIGGER",
            position: { x: 0, y: 0 },
            data: { _run: { timeoutMs: 1000 } },
          },
          {
            id: "broken-x",
            name: "Broken",
            type: "CONDITION",
            position: { x: 0, y: 0 },
            disabled: true,
            // No operator — the executor throws NonRetriableError when run.
            data: { _run: { timeoutMs: 1000 } },
          },
          {
            id: "done-x",
            name: "Done",
            type: "SET",
            position: { x: 0, y: 0 },
            data: { mappings: [], _run: { timeoutMs: 1000 } },
          },
        ],
        edges: [
          { source: "trigger-x", target: "broken-x", sourceHandle: "main" },
          { source: "broken-x", target: "done-x", sourceHandle: "true" },
        ],
      };

      const { execution, nodeExecutions } = await runGraph(graph);

      expect(execution.status).toBe(ExecutionStatus.SUCCESS);
      expect(nodeExecutions.find((n) => n.nodeName === "Broken")?.status).toBe(
        NodeExecutionStatus.SKIPPED,
      );
      // Pass-through on a branching node takes its FIRST declared output.
      expect(nodeExecutions.find((n) => n.nodeName === "Done")?.status).toBe(
        NodeExecutionStatus.SUCCESS,
      );
    });

    it("does not resurrect a branch that was never taken", async () => {
      // A disabled node on an untaken branch must stay skipped-as-unreachable;
      // marking its outgoing edges taken would run the false branch's tail.
      const graph: TemplateGraph = {
        nodes: [
          {
            id: "trigger-u",
            name: "Trigger",
            type: "MANUAL_TRIGGER",
            position: { x: 0, y: 0 },
            data: { _run: { timeoutMs: 1000 } },
          },
          {
            id: "cond-u",
            name: "Cond",
            type: "CONDITION",
            position: { x: 0, y: 0 },
            data: {
              left: "a",
              operator: "equals",
              right: "a",
              _run: { timeoutMs: 1000 },
            },
          },
          {
            id: "off-u",
            name: "OffOnFalse",
            type: "SET",
            position: { x: 0, y: 0 },
            disabled: true,
            data: { mappings: [], _run: { timeoutMs: 1000 } },
          },
          {
            id: "tail-u",
            name: "Tail",
            type: "SET",
            position: { x: 0, y: 0 },
            data: { mappings: [], _run: { timeoutMs: 1000 } },
          },
        ],
        edges: [
          { source: "trigger-u", target: "cond-u", sourceHandle: "main" },
          { source: "cond-u", target: "off-u", sourceHandle: "false" },
          { source: "off-u", target: "tail-u", sourceHandle: "main" },
        ],
      };

      const { nodeExecutions } = await runGraph(graph);

      const off = nodeExecutions.find((n) => n.nodeName === "OffOnFalse");
      expect(off?.status).toBe(NodeExecutionStatus.SKIPPED);
      // Unreachable beats disabled: the reason names the real cause.
      expect(off?.skipReason).toBe("Skipped: not reachable via taken branches");

      const tail = nodeExecutions.find((n) => n.nodeName === "Tail");
      expect(tail?.status).toBe(NodeExecutionStatus.SKIPPED);
    });
  });

  // ------------------------------------------------------------------
  // Suite 6 - Context hygiene (AF-M9-05, gap G9)
  // ------------------------------------------------------------------
  describe("context hygiene", () => {
    const SCAFFOLDING = ["$json", "$node", "$execution", "$workflow", "$now"];

    /** Every key at every depth of a stored JSON payload. */
    function allKeys(value: unknown, acc = new Set<string>()): Set<string> {
      if (Array.isArray(value)) {
        for (const v of value) allKeys(v, acc);
      } else if (value && typeof value === "object") {
        for (const [k, v] of Object.entries(value)) {
          acc.add(k);
          allKeys(v, acc);
        }
      }
      return acc;
    }

    function linearGraph(count: number): TemplateGraph {
      const nodes: TemplateGraph["nodes"] = [
        {
          id: "trigger-h",
          name: "Trigger",
          type: "MANUAL_TRIGGER",
          position: { x: 0, y: 0 },
          data: { _run: { timeoutMs: 1000 } },
        },
      ];
      const edges: TemplateGraph["edges"] = [];
      let previous = "trigger-h";
      for (let i = 0; i < count; i++) {
        const id = `set-h-${i}`;
        nodes.push({
          id,
          name: `Set${i}`,
          type: "SET",
          position: { x: 0, y: 0 },
          // A real template, so the node genuinely goes through `resolve`.
          data: {
            mappings: [
              { key: `field${i}`, value: `value-${i} {{$execution.id}}` },
            ],
            _run: { timeoutMs: 1000 },
          },
        });
        edges.push({ source: previous, target: id, sourceHandle: "main" });
        previous = id;
      }
      return { nodes, edges };
    }

    it("keeps template scaffolding out of every stored payload", async () => {
      const { execution, nodeExecutions } = await runGraph(linearGraph(3));

      expect(execution.status).toBe(ExecutionStatus.SUCCESS);

      const executionKeys = allKeys(execution.output);
      for (const key of SCAFFOLDING) {
        expect(executionKeys.has(key), `Execution.output leaked ${key}`).toBe(
          false,
        );
      }

      for (const ne of nodeExecutions) {
        for (const field of [ne.input, ne.output]) {
          const keys = allKeys(field);
          for (const key of SCAFFOLDING) {
            expect(
              keys.has(key),
              `NodeExecution(${ne.nodeName}) leaked ${key}`,
            ).toBe(false);
          }
        }
      }
    });

    it("still resolves $-prefixed expressions even though they are not stored", () => {
      // The scaffolding must be absent from the OUTPUT, not from the resolver.
      // Without this, deleting `$execution` entirely would pass the test above.
      return runGraph(linearGraph(1)).then(({ execution }) => {
        const output = execution.output as Record<string, unknown>;
        expect(typeof output.field0).toBe("string");
        // "value-0 <executionId>" - the id resolved, so $execution still works.
        expect(output.field0 as string).toMatch(/^value-0 .+/);
        expect(output.field0 as string).not.toBe("value-0 ");
      });
    });

    it("does not compound stored output as the graph gets longer", async () => {
      // Before AF-M9-05 each node returned `{ ...context }` including `$json`,
      // which self-references the context - so every hop re-nested the whole
      // previous payload and the stored size grew superlinearly with node
      // count, against the ADR-0018 per-node byte cap.
      const { execution: shortRun } = await runGraph(linearGraph(2));
      await prisma.$executeRawUnsafe(TRUNCATE);
      const { execution: longRun, nodeExecutions } = await runGraph(
        linearGraph(6),
      );

      const sizeOf = (v: unknown) => JSON.stringify(v ?? null).length;

      // Growth from 2 SET nodes to 6 must track the DATA (four more small
      // fields), not the node count. Each `SET` here writes ~20 bytes, so a
      // linear result lands near 3x; the pre-fix nesting was far worse,
      // because every hop embedded the entire previous context under `$json`.
      expect(sizeOf(longRun.output)).toBeLessThan(4 * sizeOf(shortRun.output));

      // Absolute bound too, so the ratio cannot pass by both runs bloating.
      expect(sizeOf(longRun.output)).toBeLessThan(600);

      // `NodeExecution.input`/`output` now ARE written by the engine (AF-M9-18),
      // so the hygiene assertions above at the per-node level are meaningful,
      // not vacuous — every stored row must stay under the ADR-0018 byte cap.
      for (const ne of nodeExecutions) {
        expect(ne.input).not.toBeNull();
        expect(ne.output).not.toBeNull();
        expect(serializedBytes(ne.input)).toBeLessThanOrEqual(
          MAX_NODE_OUTPUT_BYTES,
        );
        expect(serializedBytes(ne.output)).toBeLessThanOrEqual(
          MAX_NODE_OUTPUT_BYTES,
        );
      }
    });
  });

  // ------------------------------------------------------------------
  // Suite 7 - Per-node run policy (AF-M9-06, gap G11)
  // ------------------------------------------------------------------
  describe("run policy", () => {
    /** Trigger -> Flaky(SET) -> Done(SET). */
    function retryGraph(policy: Record<string, unknown>): TemplateGraph {
      return {
        nodes: [
          {
            id: "trigger-r",
            name: "Trigger",
            type: "MANUAL_TRIGGER",
            position: { x: 0, y: 0 },
            data: {},
          },
          {
            id: "flaky-r",
            name: "Flaky",
            type: "SET",
            position: { x: 0, y: 0 },
            data: {
              mappings: [{ key: "ok", value: "yes" }],
              _run: policy,
            },
          },
          {
            id: "done-r",
            name: "Done",
            type: "SET",
            position: { x: 0, y: 0 },
            data: { mappings: [] },
          },
        ],
        edges: [
          { source: "trigger-r", target: "flaky-r", sourceHandle: "main" },
          { source: "flaky-r", target: "done-r", sourceHandle: "main" },
        ],
      };
    }

    it("retries a transient failure and succeeds on the third attempt", async () => {
      const { execution, nodeExecutions, stepLog } = await runGraph(
        retryGraph({ maxAttempts: 3, backoffMs: 0 }),
        // The first two `node:flaky-r:attempt:*` steps throw.
        { failSteps: { prefix: "node:flaky-r:attempt:", times: 2 } },
      );

      expect(execution.status).toBe(ExecutionStatus.SUCCESS);

      const flaky = nodeExecutions.find((n) => n.nodeName === "Flaky");
      expect(flaky?.status).toBe(NodeExecutionStatus.SUCCESS);
      // AF-M9-06: the recorded attempt is the one it FINISHED on. Before this,
      // the row carried the Inngest function attempt (always 1), so a retry was
      // invisible in the trace.
      expect(flaky?.attempt).toBe(3);

      // All three attempts really were made, in order.
      expect(stepLog).toContain("node:flaky-r:attempt:1");
      expect(stepLog).toContain("node:flaky-r:attempt:2");
      expect(stepLog).toContain("node:flaky-r:attempt:3");
      expect(stepLog).not.toContain("node:flaky-r:attempt:4");

      // Downstream still ran.
      expect(nodeExecutions.find((n) => n.nodeName === "Done")?.status).toBe(
        NodeExecutionStatus.SUCCESS,
      );
    });

    it("honours maxAttempts: 1 as no retry at all", async () => {
      const { stepLog } = await runGraph(
        retryGraph({ maxAttempts: 1, backoffMs: 0 }),
        { failSteps: { prefix: "node:flaky-r:attempt:", times: 0 } },
      );
      expect(stepLog).toContain("node:flaky-r:attempt:1");
      expect(stepLog).not.toContain("node:flaky-r:attempt:2");
    });

    it("stops at maxAttempts and fails the run when every attempt fails", async () => {
      let threw = false;
      try {
        await runGraph(retryGraph({ maxAttempts: 2, backoffMs: 0 }), {
          failSteps: { prefix: "node:flaky-r:attempt:", times: 99 },
        });
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);

      const rows = await prisma.nodeExecution.findMany({
        orderBy: { order: "asc" },
      });
      const flaky = rows.find((n) => n.nodeName === "Flaky");
      expect(flaky?.status).toBe(NodeExecutionStatus.FAILED);
      // The failure records the last attempt tried, not the first.
      expect(flaky?.attempt).toBe(2);
      expect(rows.find((n) => n.nodeName === "Done")?.status).toBe(
        NodeExecutionStatus.SKIPPED,
      );
    });

    it("continueOnFail lets the run finish SUCCESS with the node FAILED", async () => {
      const graph = retryGraph({ maxAttempts: 1, continueOnFail: true });
      const { execution, nodeExecutions } = await runGraph(graph, {
        failSteps: { prefix: "node:flaky-r:attempt:", times: 99 },
      });

      expect(execution.status).toBe(ExecutionStatus.SUCCESS);
      expect(nodeExecutions.find((n) => n.nodeName === "Flaky")?.status).toBe(
        NodeExecutionStatus.FAILED,
      );
      // The whole point: downstream keeps going.
      expect(nodeExecutions.find((n) => n.nodeName === "Done")?.status).toBe(
        NodeExecutionStatus.SUCCESS,
      );
    });

    it("a legacy _timeoutMs node still runs, with no migration", async () => {
      // AF-M9-06 ships no data migration; rows predating it must keep working.
      const graph: TemplateGraph = {
        nodes: [
          {
            id: "trigger-l",
            name: "Trigger",
            type: "MANUAL_TRIGGER",
            position: { x: 0, y: 0 },
            data: { _timeoutMs: 1000 },
          },
          {
            id: "set-l",
            name: "Legacy",
            type: "SET",
            position: { x: 0, y: 0 },
            data: { mappings: [], _timeoutMs: 2000, _continueOnFail: true },
          },
        ],
        edges: [{ source: "trigger-l", target: "set-l", sourceHandle: "main" }],
      };

      const { execution, nodeExecutions } = await runGraph(graph);
      expect(execution.status).toBe(ExecutionStatus.SUCCESS);
      expect(nodeExecutions.find((n) => n.nodeName === "Legacy")?.status).toBe(
        NodeExecutionStatus.SUCCESS,
      );
    });
  });

  // ------------------------------------------------------------------
  // Suite 8 - Per-node input/output persistence (AF-M9-18)
  // ------------------------------------------------------------------
  describe("per-node input/output persistence (AF-M9-18)", () => {
    it("records the node's resolved input and return as genuinely distinct payloads", async () => {
      const graph: TemplateGraph = {
        nodes: [
          {
            id: "t-inout",
            name: "Trigger",
            type: "MANUAL_TRIGGER",
            position: { x: 0, y: 0 },
            data: { _run: { timeoutMs: 1000 } },
          },
          {
            id: "s-inout",
            name: "Set0",
            type: "SET",
            position: { x: 0, y: 0 },
            // A real template: input must NOT contain the field, output must.
            data: {
              mappings: [{ key: "field0", value: "value-0 {{$execution.id}}" }],
              _run: { timeoutMs: 1000 },
            },
          },
        ],
        edges: [{ source: "t-inout", target: "s-inout", sourceHandle: "main" }],
      };

      const { execution, nodeExecutions } = await runGraph(graph);

      expect(execution.status).toBe(ExecutionStatus.SUCCESS);

      const set = nodeExecutions.find((n) => n.nodeName === "Set0");
      expect(set?.status).toBe(NodeExecutionStatus.SUCCESS);

      const input = set?.input as Record<string, unknown> | null;
      const output = set?.output as Record<string, unknown> | null;
      expect(input).not.toBeNull();
      expect(output).not.toBeNull();

      const resolved = output?.field0;
      // `input` is the flat context the node RECEIVED (pre-execution) — it does
      // not yet hold the field; `output` is the node's return with the field
      // resolved. Both written, and they genuinely differ for the same node.
      expect(input?.field0).toBeUndefined();
      expect(typeof resolved).toBe("string");
      expect(resolved).toMatch(/^value-0 /);
      expect(resolved.length).toBeGreaterThan("value-0 ".length);
    });

    it("stores neither input nor output for a SKIPPED node", async () => {
      const graph: TemplateGraph = {
        nodes: [
          {
            id: "t-sk",
            name: "Trigger",
            type: "MANUAL_TRIGGER",
            position: { x: 0, y: 0 },
            data: { _run: { timeoutMs: 1000 } },
          },
          {
            id: "c-sk",
            name: "Cond",
            type: "CONDITION",
            position: { x: 0, y: 0 },
            data: {
              left: "a",
              operator: "equals",
              right: "a",
              _run: { timeoutMs: 1000 },
            },
          },
          {
            id: "yes-sk",
            name: "Yes",
            type: "SET",
            position: { x: 0, y: 0 },
            data: { mappings: [], _run: { timeoutMs: 1000 } },
          },
          {
            id: "no-sk",
            name: "No",
            type: "SET",
            position: { x: 0, y: 0 },
            data: { mappings: [], _run: { timeoutMs: 1000 } },
          },
        ],
        edges: [
          { source: "t-sk", target: "c-sk", sourceHandle: "main" },
          { source: "c-sk", target: "yes-sk", sourceHandle: "true" },
          { source: "c-sk", target: "no-sk", sourceHandle: "false" },
        ],
      };

      const { execution, nodeExecutions } = await runGraph(graph);

      expect(execution.status).toBe(ExecutionStatus.SUCCESS);

      const no = nodeExecutions.find((n) => n.nodeName === "No");
      expect(no?.status).toBe(NodeExecutionStatus.SKIPPED);
      // A skipped node never runs, so it has neither recordable input nor
      // return — an empty trace must not be confused with a truncated one.
      expect(no?.input).toBeNull();
      expect(no?.output).toBeNull();
    });
  });

  // ------------------------------------------------------------------
  // Suite — Branch isolation (AF-M9-12)
  // ------------------------------------------------------------------
  describe("branch isolation (AF-M9-12)", () => {
    const fanOutGraph: TemplateGraph = {
      nodes: [
        {
          id: "t-bi",
          name: "Trigger",
          type: "MANUAL_TRIGGER",
          position: { x: 0, y: 0 },
          data: { _run: { timeoutMs: 1000 } },
        },
        {
          id: "a-bi",
          name: "A",
          type: "SET",
          position: { x: 0, y: 0 },
          data: {
            mappings: [{ key: "fromA", value: "a-val" }],
            _run: { timeoutMs: 1000 },
          },
        },
        {
          id: "b-bi",
          name: "B",
          type: "SET",
          position: { x: 0, y: 0 },
          data: {
            mappings: [{ key: "fromB", value: "b-val" }],
            _run: { timeoutMs: 1000 },
          },
        },
        {
          id: "c-bi",
          name: "C",
          type: "SET",
          position: { x: 0, y: 0 },
          data: {
            mappings: [{ key: "fromC", value: "c-val" }],
            _run: { timeoutMs: 1000 },
          },
        },
        {
          id: "d-bi",
          name: "D",
          type: "SET",
          position: { x: 0, y: 0 },
          data: {
            mappings: [{ key: "fromD", value: "d-val" }],
            _run: { timeoutMs: 1000 },
          },
        },
      ],
      edges: [
        { source: "t-bi", target: "a-bi", sourceHandle: "main" },
        { source: "a-bi", target: "b-bi", sourceHandle: "main" },
        { source: "a-bi", target: "c-bi", sourceHandle: "main" },
        { source: "b-bi", target: "d-bi", sourceHandle: "main" },
        { source: "c-bi", target: "d-bi", sourceHandle: "main" },
      ],
    };

    it("in A → (B,C) → D, C's input is A's output, not B's", async () => {
      const { execution, nodeExecutions } = await runGraph(fanOutGraph);

      expect(execution.status).toBe(ExecutionStatus.SUCCESS);

      const c = nodeExecutions.find((n) => n.nodeName === "C");
      expect(c?.status).toBe(NodeExecutionStatus.SUCCESS);
      const cInput = c?.input as Record<string, unknown> | null;
      // C's resolved input is A's output alone — the prior rolling-context
      // behaviour would have leaked B's field into C.
      expect(cInput?.fromA).toBe("a-val");
      expect(cInput?.fromB).toBeUndefined();
    });

    it("D receives both B's and C's outputs", async () => {
      const { execution, nodeExecutions } = await runGraph(fanOutGraph);

      expect(execution.status).toBe(ExecutionStatus.SUCCESS);

      const d = nodeExecutions.find((n) => n.nodeName === "D");
      expect(d?.status).toBe(NodeExecutionStatus.SUCCESS);
      const dInput = d?.input as Record<string, unknown> | null;
      // D has two incoming edges into its single `main` port; they merge
      // left-to-right so both branches' fields reach it.
      expect(dInput?.fromA).toBe("a-val");
      expect(dInput?.fromB).toBe("b-val");
      expect(dInput?.fromC).toBe("c-val");
    });

    it("two incoming edges into one port merge deterministically across repeated runs", async () => {
      const first = await runGraph(fanOutGraph);
      const second = await runGraph(fanOutGraph);

      const d1 = first.nodeExecutions.find((n) => n.nodeName === "D");
      const d2 = second.nodeExecutions.find((n) => n.nodeName === "D");

      const input1 = d1?.input as Record<string, unknown> | null;
      const input2 = d2?.input as Record<string, unknown> | null;
      expect(input1).toEqual(input2);
      // Same edges in the same order yield the same merged input every run,
      // so the fan-out merge is a pure function of the persisted graph.
      expect(input1?.fromA).toBe("a-val");
      expect(input1?.fromB).toBe("b-val");
      expect(input1?.fromC).toBe("c-val");
    });
  });
});
