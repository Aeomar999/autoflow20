import type { TemplateGraph } from "@/features/templates/server/instantiate";
import { ExecutionStatus } from "@/generated/prisma/client";
import { executeWorkflowHandler } from "@/inngest/functions";
import prisma from "@/lib/db";

type HandlerCtx = Parameters<typeof executeWorkflowHandler>[0];

/**
 * Memoless fake Inngest step — each `run` executes the callback inline.
 * No replay, no memoisation; the executor is invoked exactly once.
 *
 * The result is deep-cloned via JSON round-trip, mirroring real Inngest
 * serialization semantics: the executor's `buildTemplateContext` adds a
 * `$json` field that self-references the accumulated context, so without
 * this clone the subsequent `serializedBytes` (JSON.stringify) would throw
 * "Converting circular structure to JSON". Cloning also keeps later nodes'
 * contexts independent of earlier ones, matching persisted-step behaviour.
 */
function makeStep() {
  return {
    run: async (_name: string, fn: () => unknown) => {
      const value = await fn();
      if (value === undefined || value === null) return value;
      try {
        return JSON.parse(JSON.stringify(value));
      } catch {
        return value;
      }
    },
    sleep: async () => {},
    waitForEvent: async () => null,
    apply: async () => null,
  };
}

/**
 * Run a graph through the execution engine against a real Postgres.
 *
 * Seeds an org + user + workflow + execution row, converts the
 * TemplateGraph edges to the executor's connection format, and drives
 * `executeWorkflowHandler` directly (no Inngest dev server).
 *
 * Returns the execution row and all node execution traces so tests
 * can assert on real DB state.
 */
export async function runGraph(
  spec: TemplateGraph,
  opts?: {
    /** Override execution mode. Defaults to "TEST" (bypasses quota gate). */
    mode?: string;
    /** Pre-seed this execution id instead of generating one. */
    executionId?: string;
    /** Reuse an existing tenant instead of creating a fresh one. */
    orgId?: string;
    /** Reuse this user id with the (reused) org. Requires orgId. */
    userId?: string;
    /** Reuse this workflow id instead of creating one. Requires orgId. */
    workflowId?: string;
  },
): Promise<{
  execution: Awaited<ReturnType<typeof prisma.execution.findUniqueOrThrow>>;
  nodeExecutions: Awaited<ReturnType<typeof prisma.nodeExecution.findMany>>;
}> {
  const userId = opts?.userId ?? `user-eng-${Date.now()}`;

  await prisma.user.createMany({
    data: [{ id: userId, name: "Engine User", email: `${userId}@test.local` }],
    skipDuplicates: true,
  });

  const resolvedOrgId =
    opts?.orgId ??
    (
      await prisma.organization.create({
        data: {
          name: "Engine Test",
          slug: `eng-org-${Date.now()}`,
          members: { create: { userId, role: "OWNER" } },
        },
        select: { id: true },
      })
    ).id;

  const workflowId =
    opts?.workflowId ??
    (
      await prisma.workflow.create({
        data: {
          name: "engine-test-wf",
          userId,
          organizationId: resolvedOrgId,
        },
        select: { id: true },
      })
    ).id;

  const mode = opts?.mode ?? "TEST";
  const executionId = opts?.executionId ?? `exec-eng-${Date.now()}`;
  const eventId = `evt-eng-${Date.now()}`;

  await prisma.execution.create({
    data: {
      id: executionId,
      workflowId,
      inngestEventId: eventId,
      trigger: "MANUAL",
      mode,
      status: ExecutionStatus.RUNNING,
      organizationId: resolvedOrgId,
    },
  });

  const connections = spec.edges.map((e) => ({
    fromNodeId: e.source,
    toNodeId: e.target,
    fromOutput: e.sourceHandle ?? "main",
    toInput: e.targetHandle ?? "main",
  }));

  const graphSnapshot = { nodes: spec.nodes, connections };

  const event = {
    name: "workflows.execute.workflow" as const,
    id: eventId,
    ts: Date.now(),
    data: {
      workflowId,
      executionId,
      mode,
      graphSnapshot,
    },
  };

  const step = makeStep();

  await executeWorkflowHandler({
    event,
    runId: "run-test",
    events: [event] as HandlerCtx["events"],
    step: step as unknown as HandlerCtx["step"],
    publish: (async () => ({ ids: [] })) as unknown as HandlerCtx["publish"],
    attempt: 1,
  });

  const execution = await prisma.execution.findUniqueOrThrow({
    where: { id: executionId },
  });

  const nodeExecutions = await prisma.nodeExecution.findMany({
    where: { executionId },
    orderBy: { order: "asc" },
  });

  return { execution, nodeExecutions };
}
