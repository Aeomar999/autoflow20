import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  ExecutionStatus,
  NodeExecutionStatus,
} from "@/generated/prisma/client";
import { executeWorkflowHandler } from "@/inngest/functions";
import prisma from "@/lib/db";

/**
 * AF-M8-27: Cooperative cancellation. `POST /api/v1/executions/:id/cancel`
 * writes CANCELLED (+ completedAt) but does not interrupt the Inngest run, so
 * the run must cooperate: stop scheduling remaining nodes, write them as
 * SKIPPED, suppress the final SUCCESS write, and return CANCELLED.
 *
 * The handler is driven directly (no Inngest dev server). `step` is faked with
 * a memoless `run` that executes each callback — the executor is invoked once,
 * so replay semantics do not matter. `publish` is a no-op; realtime channels
 * are out of scope here.
 *
 * TEST-mode executions never hit the quota gate, and `E2E_SERVER=1` is set as
 * a belt-and-braces bypass (mirrors org-isolation).
 */
const dbUrl = process.env.TEST_DATABASE_URL;
const hasDb = Boolean(dbUrl);

describe.runIf(hasDb)("Executor cooperative cancellation (AF-M8-27)", () => {
  const triggerNodeId = "n-trigger";
  const setNodeId = "n-set";

  let userId: string;
  let organizationId: string;
  let workflowId: string;

  beforeAll(() => {
    process.env.E2E_SERVER = "1";
  });

  afterAll(() => {
    delete process.env.E2E_SERVER;
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE "organization","member","invitation","workspace","WorkflowVersion","NodeExecution","Execution","Connection","Node","Workflow","Credential","user","session","account","verification" CASCADE`,
    );

    userId = "user_exec";
    await prisma.user.create({
      data: { id: userId, name: "Exec User", email: "exec@test.local" },
    });
    const org = await prisma.organization.create({
      data: {
        name: "Exec Cancel",
        slug: "exec-cancel-integration",
        members: { create: { userId, role: "OWNER" } },
      },
      select: { id: true },
    });
    organizationId = org.id;
    const workflow = await prisma.workflow.create({
      data: { name: "exec-cancel-workflow", userId, organizationId },
      select: { id: true },
    });
    workflowId = workflow.id;
  });

  /**
   * Inline graph (AF-M2-08 snapshot pattern): a manual trigger followed by a
   * set node. `_timeoutMs` keeps the per-node timeout timer short so the
   * executor's `Promise.race` does not leave a 30s timer arming the worker.
   */
  function graphSnapshot() {
    return {
      nodes: [
        {
          id: triggerNodeId,
          name: "Trigger",
          type: "MANUAL_TRIGGER",
          data: { _timeoutMs: 1000 },
        },
        {
          id: setNodeId,
          name: "Set",
          type: "SET",
          data: { mappings: [], _timeoutMs: 1000 },
        },
      ],
      connections: [
        {
          fromNodeId: triggerNodeId,
          toNodeId: setNodeId,
          fromOutput: "main",
          toInput: "main",
        },
      ],
    };
  }

  function eventFor(executionId: string, eventId: string) {
    return {
      name: "workflows.execute.workflow",
      id: eventId,
      ts: Date.now(),
      data: {
        workflowId,
        executionId,
        mode: "TEST",
        graphSnapshot: graphSnapshot(),
      },
    };
  }

  /**
   * Minimal fake Inngest step. `run` executes the callback; an optional hook
   * runs after each step so a test can simulate cancellation landing mid-run.
   */
  function makeStep(cancelHook?: (stepName: string) => Promise<void>) {
    return {
      run: async (name: string, fn: () => unknown) => {
        const value = await fn();
        await cancelHook?.(name);
        return value;
      },
      sleep: async () => {},
      waitForEvent: async () => null,
      apply: async () => null,
    };
  }

  type HandlerCtx = Parameters<typeof executeWorkflowHandler>[0];

  async function runHandler(
    executionId: string,
    eventId: string,
    step: ReturnType<typeof makeStep>,
  ) {
    return executeWorkflowHandler({
      event: eventFor(executionId, eventId),
      runId: "run-test",
      events: [eventFor(executionId, eventId)] as HandlerCtx["events"],
      step: step as unknown as HandlerCtx["step"],
      publish: (async () => ({ ids: [] })) as unknown as HandlerCtx["publish"],
      attempt: 1,
    });
  }

  it("pre-cancelled: every node is SKIPPED and the row keeps CANCELLED", async () => {
    const executionId = "exe_pre_cancelled";
    const eventId = "evt_pre_cancelled";
    await prisma.execution.create({
      data: {
        id: executionId,
        workflowId,
        inngestEventId: eventId,
        trigger: "MANUAL",
        mode: "TEST",
        status: ExecutionStatus.CANCELLED,
        organizationId,
      },
    });

    const result = await runHandler(executionId, eventId, makeStep(undefined));

    expect(result).toEqual({ workflowId, status: ExecutionStatus.CANCELLED });

    const execution = await prisma.execution.findUnique({
      where: { id: executionId },
    });
    expect(execution?.status).toBe(ExecutionStatus.CANCELLED);

    const traces = await prisma.nodeExecution.findMany({
      where: { executionId },
      orderBy: { order: "asc" },
    });
    expect(traces).toHaveLength(2);
    for (const trace of traces) {
      expect(trace.status).toBe(NodeExecutionStatus.SKIPPED);
      expect(trace.skipReason).toBe("Skipped: execution cancelled");
    }
  });

  it("in-flight: the running node finishes, the rest are SKIPPED, the row keeps CANCELLED", async () => {
    const executionId = "exe_in_flight";
    const eventId = "evt_in_flight";
    await prisma.execution.create({
      data: {
        id: executionId,
        workflowId,
        inngestEventId: eventId,
        trigger: "MANUAL",
        mode: "TEST",
        status: ExecutionStatus.RUNNING,
        organizationId,
      },
    });

    // Simulate the cancel route firing mid-run: flip the row the moment the
    // trigger node's step completes and before the next node's cancel-check
    // reads it.
    //
    // AF-M10-34: this used to hook `manual-trigger`, the step the trigger's
    // executor opened inside the engine's own. Executors no longer reach the
    // real step tooling — nesting it is what hung every production run — so
    // the hook is now the engine's node step, which is the boundary this test
    // actually means and the only one a deployed run has.
    let flipped = false;
    const step = makeStep(async (name) => {
      if (name === `node:${triggerNodeId}:attempt:1` && !flipped) {
        flipped = true;
        await prisma.execution.update({
          where: { id: executionId },
          data: {
            status: ExecutionStatus.CANCELLED,
            completedAt: new Date(),
          },
        });
      }
    });

    const result = await runHandler(executionId, eventId, step);

    expect(flipped).toBe(true);
    expect(result).toEqual({ workflowId, status: ExecutionStatus.CANCELLED });

    const execution = await prisma.execution.findUnique({
      where: { id: executionId },
    });
    expect(execution?.status).toBe(ExecutionStatus.CANCELLED);

    const traces = await prisma.nodeExecution.findMany({
      where: { executionId },
      orderBy: { order: "asc" },
    });
    expect(traces).toHaveLength(2);
    expect(traces[0]?.status).toBe(NodeExecutionStatus.SUCCESS);
    expect(traces[1]?.status).toBe(NodeExecutionStatus.SKIPPED);
    expect(traces[1]?.skipReason).toBe("Skipped: execution cancelled");
  });
});
