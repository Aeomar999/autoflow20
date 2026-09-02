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
  describe("CONDITION regression (G1 bug)", () => {
    it("editor-style edge ids source-1 cause downstream to be SKIPPED instead of SUCCESS (BUG until AF-M9-03)", async () => {
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

      // CONDITION sets _outputPort="true" but markTakenEdges checks
      // edge.fromOutput === outputPort → "source-1" !== "true" → no match.
      // Done is never reached via takenEdges → SKIPPED (G1 bug).
      const condition = nodeExecutions.find((n) => n.nodeName === "Cond");
      expect(condition?.status).toBe(NodeExecutionStatus.SUCCESS);

      const done = nodeExecutions.find((n) => n.nodeName === "Done");

      // This assertion documents the BUG: Done is SKIPPED when it should
      // be SUCCESS. Once AF-M9-03 lands, flip this to:
      //   expect(done?.status).toBe(NodeExecutionStatus.SUCCESS);
      expect(done?.status).toBe(NodeExecutionStatus.SKIPPED);
      expect(done?.skipReason).toBe(
        "Skipped: not reachable via taken branches",
      );

      // Execution still succeeds — skipped nodes don't block completion.
      expect(execution.status).toBe(ExecutionStatus.SUCCESS);
    });
  });
});
