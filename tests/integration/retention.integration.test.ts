import { beforeEach, describe, expect, it } from "vitest";
import {
  applyRetentionPolicy,
  sweepExecutionRetention,
} from "@/features/executions/server/retention";
import prisma from "@/lib/db";
import { PLAN_RETENTION } from "@/lib/retention";

/**
 * AF-M8-06 against a real Postgres. The parts worth proving with a database
 * rather than a mock are the ones a unit test cannot see: that redaction
 * leaves the metrics a dashboard reads, that deleting an `Execution` really
 * does cascade to `NodeExecution`, that one org's plan never governs another
 * org's rows, and that a second sweep is a no-op.
 */

const hasDb = Boolean(process.env.TEST_DATABASE_URL);

/** Fixed clock so every age in these tests is exact. */
const NOW = new Date("2026-09-01T12:00:00.000Z");
const daysAgo = (days: number) =>
  new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);

describe.runIf(hasDb)("execution retention (AF-M8-06)", () => {
  let orgFree: string;
  let orgEnterprise: string;
  let workflowFree: string;
  let workflowEnterprise: string;

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE "AiResponseCache","organization","member","invitation","workspace","WorkflowVersion","NodeExecution","Execution","Connection","Node","Workflow","Credential","user","session","account","verification" CASCADE`,
    );

    await prisma.user.create({
      data: {
        id: "user_retention",
        email: "retention@test.local",
        name: "Retention",
        emailVerified: true,
      },
    });

    const free = await prisma.organization.create({
      data: {
        name: "Free Org",
        slug: "retention-free",
        plan: "FREE",
        members: { create: { userId: "user_retention", role: "OWNER" } },
      },
    });
    const enterprise = await prisma.organization.create({
      data: {
        name: "Enterprise Org",
        slug: "retention-enterprise",
        plan: "ENTERPRISE",
      },
    });
    orgFree = free.id;
    orgEnterprise = enterprise.id;

    workflowFree = (
      await prisma.workflow.create({
        data: {
          name: "Free WF",
          userId: "user_retention",
          organizationId: orgFree,
        },
      })
    ).id;
    workflowEnterprise = (
      await prisma.workflow.create({
        data: {
          name: "Enterprise WF",
          userId: "user_retention",
          organizationId: orgEnterprise,
        },
      })
    ).id;
  });

  /** One execution with one node execution, both carrying IO payloads. */
  const seedRun = async (opts: {
    workflowId: string;
    organizationId: string | null;
    ageDays: number;
    tag: string;
  }) => {
    const startedAt = daysAgo(opts.ageDays);
    const execution = await prisma.execution.create({
      data: {
        workflowId: opts.workflowId,
        organizationId: opts.organizationId,
        status: "SUCCESS",
        startedAt,
        completedAt: startedAt,
        durationMs: 1234,
        tokensIn: 100,
        tokensOut: 50,
        costUsd: "0.001234",
        inngestEventId: `evt_${opts.tag}`,
        input: { secret: `in-${opts.tag}` },
        output: { secret: `out-${opts.tag}` },
      },
    });

    await prisma.nodeExecution.create({
      data: {
        executionId: execution.id,
        nodeId: `node_${opts.tag}`,
        nodeName: "HTTP Request",
        nodeType: "HTTP_REQUEST",
        order: 0,
        status: "SUCCESS",
        startedAt,
        finishedAt: startedAt,
        durationMs: 567,
        tokensIn: 100,
        tokensOut: 50,
        costUsd: "0.001234",
        model: "openai:gpt-4o",
        input: { secret: `node-in-${opts.tag}` },
        output: { secret: `node-out-${opts.tag}` },
      },
    });

    return execution.id;
  };

  const sweepFree = () =>
    applyRetentionPolicy({ organizationId: orgFree }, PLAN_RETENTION.FREE, {
      now: NOW,
    });

  it("leaves a run inside the IO window completely untouched", async () => {
    const id = await seedRun({
      workflowId: workflowFree,
      organizationId: orgFree,
      ageDays: 1,
      tag: "fresh",
    });

    await sweepFree();

    const execution = await prisma.execution.findUnique({ where: { id } });
    expect(execution?.input).toEqual({ secret: "in-fresh" });
    expect(execution?.output).toEqual({ secret: "out-fresh" });
  });

  it("redacts IO past the window but keeps everything a dashboard reads", async () => {
    const id = await seedRun({
      workflowId: workflowFree,
      organizationId: orgFree,
      ageDays: 10, // past FREE's 7-day IO window, inside its 35-day delete window
      tag: "stale",
    });

    const result = await sweepFree();

    expect(result.redactedExecutions).toBe(1);
    expect(result.redactedNodeExecutions).toBe(1);
    expect(result.deletedExecutions).toBe(0);

    const execution = await prisma.execution.findUnique({ where: { id } });
    expect(execution).not.toBeNull();
    expect(execution?.input).toBeNull();
    expect(execution?.output).toBeNull();
    // The trace survives - this is the whole point of redacting rather than
    // deleting at this stage.
    expect(execution?.status).toBe("SUCCESS");
    expect(execution?.durationMs).toBe(1234);
    expect(execution?.tokensIn).toBe(100);
    expect(Number(execution?.costUsd)).toBeCloseTo(0.001234, 6);

    const node = await prisma.nodeExecution.findFirst({
      where: { executionId: id },
    });
    expect(node?.input).toBeNull();
    expect(node?.output).toBeNull();
    expect(node?.status).toBe("SUCCESS");
    expect(node?.durationMs).toBe(567);
    expect(node?.model).toBe("openai:gpt-4o");
  });

  it("deletes past the delete window and cascades to node executions", async () => {
    const id = await seedRun({
      workflowId: workflowFree,
      organizationId: orgFree,
      ageDays: 40, // past FREE's 35-day delete window
      tag: "ancient",
    });

    const result = await sweepFree();

    expect(result.deletedExecutions).toBe(1);
    expect(await prisma.execution.findUnique({ where: { id } })).toBeNull();
    expect(
      await prisma.nodeExecution.count({ where: { executionId: id } }),
    ).toBe(0);
  });

  it("never deletes for a plan with an unlimited window, but still redacts", async () => {
    const recent = await seedRun({
      workflowId: workflowEnterprise,
      organizationId: orgEnterprise,
      ageDays: 400, // older than any other plan's delete window
      tag: "ent-old",
    });

    const result = await applyRetentionPolicy(
      { organizationId: orgEnterprise },
      PLAN_RETENTION.ENTERPRISE,
      { now: NOW },
    );

    expect(result.deletedExecutions).toBe(0);
    const execution = await prisma.execution.findUnique({
      where: { id: recent },
    });
    expect(execution).not.toBeNull();
    // 400 days is past ENTERPRISE's 365-day IO window.
    expect(execution?.input).toBeNull();
  });

  it("does not apply one org's plan to another org's rows", async () => {
    const freeRun = await seedRun({
      workflowId: workflowFree,
      organizationId: orgFree,
      ageDays: 40,
      tag: "free-40",
    });
    const enterpriseRun = await seedRun({
      workflowId: workflowEnterprise,
      organizationId: orgEnterprise,
      ageDays: 40,
      tag: "ent-40",
    });

    await sweepExecutionRetention({ now: NOW });

    // 40 days is past FREE's delete window and far inside ENTERPRISE's.
    expect(
      await prisma.execution.findUnique({ where: { id: freeRun } }),
    ).toBeNull();
    const survivor = await prisma.execution.findUnique({
      where: { id: enterpriseRun },
    });
    expect(survivor).not.toBeNull();
    // Well inside ENTERPRISE's 365-day IO window, so the payload is intact.
    expect(survivor?.input).toEqual({ secret: "in-ent-40" });
  });

  it("sweeps organization-less legacy rows under FREE", async () => {
    const orphan = await seedRun({
      workflowId: workflowFree,
      organizationId: null,
      ageDays: 40,
      tag: "orphan",
    });

    await sweepExecutionRetention({ now: NOW });

    expect(
      await prisma.execution.findUnique({ where: { id: orphan } }),
    ).toBeNull();
  });

  it("is idempotent - a second sweep finds nothing left to do", async () => {
    await seedRun({
      workflowId: workflowFree,
      organizationId: orgFree,
      ageDays: 10,
      tag: "twice",
    });

    const first = await sweepFree();
    expect(first.redactedExecutions).toBe(1);
    expect(first.redactedNodeExecutions).toBe(1);

    const second = await sweepFree();
    expect(second.redactedExecutions).toBe(0);
    expect(second.redactedNodeExecutions).toBe(0);
    expect(second.deletedExecutions).toBe(0);
  });

  it("reports truncation instead of running unbounded, and resumes next sweep", async () => {
    for (let i = 0; i < 3; i += 1) {
      await seedRun({
        workflowId: workflowFree,
        organizationId: orgFree,
        ageDays: 40,
        tag: `bulk-${i}`,
      });
    }

    const first = await applyRetentionPolicy(
      { organizationId: orgFree },
      PLAN_RETENTION.FREE,
      { now: NOW, batchSize: 1, maxBatches: 2 },
    );

    expect(first.deletedExecutions).toBe(2);
    expect(first.truncated).toBe(true);
    expect(
      await prisma.execution.count({ where: { organizationId: orgFree } }),
    ).toBe(1);

    const second = await applyRetentionPolicy(
      { organizationId: orgFree },
      PLAN_RETENTION.FREE,
      { now: NOW, batchSize: 1, maxBatches: 2 },
    );

    expect(second.deletedExecutions).toBe(1);
    expect(
      await prisma.execution.count({ where: { organizationId: orgFree } }),
    ).toBe(0);
  });

  it("prunes a run still marked RUNNING once it is far past the window", async () => {
    // A run older than the delete floor cannot be in flight; excluding
    // non-terminal rows would leak exactly the runs that crashed.
    const startedAt = daysAgo(40);
    const stuck = await prisma.execution.create({
      data: {
        workflowId: workflowFree,
        organizationId: orgFree,
        status: "RUNNING",
        startedAt,
        inngestEventId: "evt_stuck",
      },
    });

    await sweepFree();

    expect(
      await prisma.execution.findUnique({ where: { id: stuck.id } }),
    ).toBeNull();
  });
});
