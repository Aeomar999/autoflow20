import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { TemplateGraph } from "@/features/templates/server/instantiate";
import {
  ExecutionStatus,
  NodeExecutionStatus,
} from "@/generated/prisma/client";
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
            data: { _timeoutMs: 1000 },
          },
          {
            id: "set-1",
            name: "Set",
            type: "SET",
            position: { x: 0, y: 0 },
            data: { mappings: [], _timeoutMs: 1000 },
          },
          {
            id: "done-1",
            name: "Done",
            type: "SET",
            position: { x: 0, y: 0 },
            data: { mappings: [], _timeoutMs: 1000 },
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
            data: { _timeoutMs: 1000 },
          },
          {
            id: "cond-fail",
            name: "CondNoOp",
            type: "CONDITION",
            position: { x: 0, y: 0 },
            data: { _timeoutMs: 1000 },
          },
          {
            id: "done-2",
            name: "Done",
            type: "SET",
            position: { x: 0, y: 0 },
            data: { mappings: [], _timeoutMs: 1000 },
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
            data: { _timeoutMs: 1000 },
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
            data: { _timeoutMs: 1000 },
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
              _timeoutMs: 1000,
            },
          },
          {
            id: "done-g1",
            name: "Done",
            type: "SET",
            position: { x: 0, y: 0 },
            data: { mappings: [], _timeoutMs: 1000 },
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
            data: { _timeoutMs: 1000 },
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
              _timeoutMs: 1000,
            },
          },
          {
            id: "yes-b",
            name: "Yes",
            type: "SET",
            position: { x: 0, y: 0 },
            data: { mappings: [], _timeoutMs: 1000 },
          },
          {
            id: "no-b",
            name: "No",
            type: "SET",
            position: { x: 0, y: 0 },
            data: { mappings: [], _timeoutMs: 1000 },
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
            data: { _timeoutMs: 1000 },
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
              _timeoutMs: 1000,
            },
          },
          {
            id: "yes-f",
            name: "Yes",
            type: "SET",
            position: { x: 0, y: 0 },
            data: { mappings: [], _timeoutMs: 1000 },
          },
          {
            id: "no-f",
            name: "No",
            type: "SET",
            position: { x: 0, y: 0 },
            data: { mappings: [], _timeoutMs: 1000 },
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
            data: { _timeoutMs: 1000 },
          },
          {
            id: "seed-d",
            name: "Seed",
            type: "SET",
            position: { x: 0, y: 0 },
            data: {
              mappings: [{ key: "marker", value: "from-upstream" }],
              _timeoutMs: 1000,
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
              _timeoutMs: 1000,
            },
          },
          {
            id: "done-d",
            name: "Done",
            type: "SET",
            position: { x: 0, y: 0 },
            data: { mappings: [], _timeoutMs: 1000 },
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
            data: { _timeoutMs: 1000 },
          },
          {
            id: "broken-x",
            name: "Broken",
            type: "CONDITION",
            position: { x: 0, y: 0 },
            disabled: true,
            // No operator — the executor throws NonRetriableError when run.
            data: { _timeoutMs: 1000 },
          },
          {
            id: "done-x",
            name: "Done",
            type: "SET",
            position: { x: 0, y: 0 },
            data: { mappings: [], _timeoutMs: 1000 },
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
            data: { _timeoutMs: 1000 },
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
              _timeoutMs: 1000,
            },
          },
          {
            id: "off-u",
            name: "OffOnFalse",
            type: "SET",
            position: { x: 0, y: 0 },
            disabled: true,
            data: { mappings: [], _timeoutMs: 1000 },
          },
          {
            id: "tail-u",
            name: "Tail",
            type: "SET",
            position: { x: 0, y: 0 },
            data: { mappings: [], _timeoutMs: 1000 },
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
});
