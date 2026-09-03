import type { TemplateGraph } from "@/features/templates/server/instantiate";
import { ExecutionStatus } from "@/generated/prisma/client";
import { executeWorkflowHandler } from "@/inngest/functions";
import prisma from "@/lib/db";
import { resolveEdgePorts } from "@/nodes/ports";

type HandlerCtx = Parameters<typeof executeWorkflowHandler>[0];

/**
 * Memoless fake Inngest step — each `run` executes the callback inline.
 * No replay, no memoisation; the executor is invoked exactly once.
 *
 * The result is deep-cloned via JSON round-trip, mirroring real Inngest
 * serialization semantics: a persisted step returns a fresh value, so later
 * nodes' contexts stay independent of earlier ones.
 *
 * Until AF-M9-05 the clone was also load-bearing for a second reason: the
 * executor received the *enriched* context, whose `$json` self-references it,
 * so `serializedBytes` (JSON.stringify) threw "Converting circular structure
 * to JSON" without it. That is fixed at the source — the enriched view now
 * lives only inside the injected `resolve` — so the clone is back to being
 * only a fidelity measure. Keep it: dropping it would let a mutation in one
 * node be visible in an earlier node's recorded output, which real Inngest
 * would never do.
 */
function makeStep(opts?: {
  /** Throw for the first `times` step.run calls whose name starts with this. */
  failSteps?: { prefix: string; times: number };
  /** Every step.run name, in order — lets a test assert what was attempted. */
  log?: string[];
}) {
  let failures = 0;
  return {
    run: async (_name: string, fn: () => unknown) => {
      opts?.log?.push(_name);
      const failSpec = opts?.failSteps;
      if (
        failSpec &&
        _name.startsWith(failSpec.prefix) &&
        failures < failSpec.times
      ) {
        failures += 1;
        // Fails at the step boundary, which is exactly where the engine's
        // per-node retry loop catches — so the retry path is genuinely
        // exercised rather than simulated.
        throw new Error(`injected transient failure #${failures}`);
      }
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
    /** Inject transient failures at the step boundary (AF-M9-06 retry tests). */
    failSteps?: { prefix: string; times: number };
  },
): Promise<{
  execution: Awaited<ReturnType<typeof prisma.execution.findUniqueOrThrow>>;
  nodeExecutions: Awaited<ReturnType<typeof prisma.nodeExecution.findMany>>;
  /** Every `step.run` name in order, so a test can assert what was attempted. */
  stepLog: string[];
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

  // AF-M9-03: resolve handles through the same helper `saveGraph` and
  // `buildTestGraph` use, so the harness executes the graph a real save would
  // have persisted — including translating a pre-AF-M9-03 `source-1` handle
  // onto the node's first declared port.
  const typeOfNode = (nodeId: string) => {
    const node = spec.nodes.find((n) => n.id === nodeId);
    return node ? { type: node.type, data: node.data } : undefined;
  };

  const connections = spec.edges.map((e) => ({
    fromNodeId: e.source,
    toNodeId: e.target,
    ...resolveEdgePorts(e, typeOfNode),
  }));

  // `TemplateNode` already carries `disabled`; it must reach the engine's
  // snapshot path or AF-M9-04 cannot be tested through this harness.
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

  const stepLog: string[] = [];
  const step = makeStep({ failSteps: opts?.failSteps, log: stepLog });

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

  return { execution, nodeExecutions, stepLog };
}
