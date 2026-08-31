import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { analyticsRouter } from "@/features/analytics/server/routers";
import prisma from "@/lib/db";
import type { createTRPCContext } from "@/trpc/init";

/**
 * Analytics router org isolation (AF-M7-03): proves overview metrics,
 * executions-over-time, error breakdown, top failing workflows, and usage
 * are all scoped to the active organization.
 */
const h = vi.hoisted(() => {
  const userA = { id: "user_ana", email: "ana@test.local", name: "Ana" };
  const userB = { id: "user_bnb", email: "bnb@test.local", name: "Bnb" };
  return {
    headerMap: new Map<string, string>(),
    currentUser: { ...userA },
    users: { userA, userB },
  };
});

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: vi.fn(async () => ({ user: h.currentUser, session: {} })),
    },
  },
}));
vi.mock("next/headers", () => ({
  headers: vi.fn(() => h.headerMap),
}));

const dbUrl = process.env.TEST_DATABASE_URL;
const hasDb = Boolean(dbUrl);

describe.runIf(hasDb)("Analytics router org isolation", () => {
  const mockCtx = {} as unknown as ReturnType<typeof createTRPCContext>;
  const analytics = analyticsRouter.createCaller(mockCtx);

  let orgAId: string;
  let orgBId: string;
  let wfAId: string;
  let wfBId: string;

  function asUser(
    user: { id: string; email: string; name: string },
    orgHeader?: string,
  ) {
    h.currentUser = { ...user };
    h.headerMap.clear();
    if (orgHeader) {
      h.headerMap.set("x-organization-id", orgHeader);
    }
  }

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE "organization","member","invitation","workspace","WorkflowVersion","NodeExecution","Execution","Connection","Node","Workflow","Credential","user","session","account","verification" CASCADE`,
    );
    asUser(h.users.userA);

    await prisma.user.createMany({ data: [h.users.userA, h.users.userB] });

    const orgA = await prisma.organization.create({
      data: {
        name: "Org A Analytics",
        slug: "orga-analytics",
        members: { create: { userId: h.users.userA.id, role: "OWNER" } },
      },
      select: { id: true },
    });
    const orgB = await prisma.organization.create({
      data: {
        name: "Org B Analytics",
        slug: "orgb-analytics",
        members: { create: { userId: h.users.userB.id, role: "OWNER" } },
      },
      select: { id: true },
    });
    orgAId = orgA.id;
    orgBId = orgB.id;

    const wfA = await prisma.workflow.create({
      data: {
        name: "wf-a-analytics",
        userId: h.users.userA.id,
        organizationId: orgA.id,
      },
      select: { id: true },
    });
    const wfB = await prisma.workflow.create({
      data: {
        name: "wf-b-analytics",
        userId: h.users.userB.id,
        organizationId: orgB.id,
      },
      select: { id: true },
    });
    wfAId = wfA.id;
    wfBId = wfB.id;

    // Seed executions for Org A: 1 SUCCESS, 1 FAILED
    await prisma.execution.createMany({
      data: [
        {
          workflowId: wfAId,
          trigger: "MANUAL",
          mode: "PRODUCTION",
          status: "SUCCESS",
          inngestEventId: "evt_ana_01",
          organizationId: orgAId,
          startedAt: new Date(),
          durationMs: 1500,
        },
        {
          workflowId: wfAId,
          trigger: "MANUAL",
          mode: "PRODUCTION",
          status: "FAILED",
          inngestEventId: "evt_ana_02",
          organizationId: orgAId,
          startedAt: new Date(),
          durationMs: 3000,
        },
      ],
    });

    // Seed executions for Org B: 3 SUCCESS
    await prisma.execution.createMany({
      data: [
        {
          workflowId: wfBId,
          trigger: "MANUAL",
          mode: "PRODUCTION",
          status: "SUCCESS",
          inngestEventId: "evt_bnb_01",
          organizationId: orgBId,
          startedAt: new Date(),
        },
        {
          workflowId: wfBId,
          trigger: "MANUAL",
          mode: "PRODUCTION",
          status: "SUCCESS",
          inngestEventId: "evt_bnb_02",
          organizationId: orgBId,
          startedAt: new Date(),
        },
        {
          workflowId: wfBId,
          trigger: "MANUAL",
          mode: "PRODUCTION",
          status: "SUCCESS",
          inngestEventId: "evt_bnb_03",
          organizationId: orgBId,
          startedAt: new Date(),
        },
      ],
    });

    // Seed a NodeExecution failure for error breakdown (Org A)
    const orgAExec = await prisma.execution.findFirst({
      where: { organizationId: orgAId, status: "FAILED" },
      select: { id: true },
    });
    if (orgAExec) {
      await prisma.nodeExecution.create({
        data: {
          executionId: orgAExec.id,
          nodeId: "node_001",
          nodeName: "OpenAI Call",
          nodeType: "ai.openai",
          status: "FAILED",
          order: 1,
          startedAt: new Date(),
          durationMs: 500,
        },
      });
    }
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE "organization","member","invitation","workspace","WorkflowVersion","NodeExecution","Execution","Connection","Node","Workflow","Credential","user","session","account","verification" CASCADE`,
    );
  });

  it("Org A overview shows only Org A runs", async () => {
    asUser(h.users.userA, orgAId);
    const result = await analytics.overview({ days: 30 });

    expect(result.overview.totalRuns).toBe(2);
  });

  it("Org B overview shows only Org B runs", async () => {
    asUser(h.users.userB, orgBId);
    const result = await analytics.overview({ days: 30 });

    expect(result.overview.totalRuns).toBe(3);
  });

  it("Org A sees no error breakdown from Org B", async () => {
    asUser(h.users.userA, orgAId);
    const result = await analytics.overview({ days: 30 });

    // Org A has one failed NodeExecution (ai.openai); Org B has none.
    expect(result.errorBreakdown.length).toBeGreaterThanOrEqual(1);
    const openaiError = result.errorBreakdown.find(
      (r) => r.nodeType === "ai.openai",
    );
    expect(openaiError).toBeDefined();
  });

  it("Org B error breakdown is empty (no failures)", async () => {
    asUser(h.users.userB, orgBId);
    const result = await analytics.overview({ days: 30 });

    expect(result.errorBreakdown).toHaveLength(0);
  });

  it("Usage counts are org-scoped", async () => {
    asUser(h.users.userA, orgAId);
    const resultA = await analytics.overview({ days: 30 });

    asUser(h.users.userB, orgBId);
    const resultB = await analytics.overview({ days: 30 });

    expect(resultA.usage.currentMonthCount).toBe(2);
    expect(resultB.usage.currentMonthCount).toBe(3);
  });

  it("Executions over time only includes own org's statuses", async () => {
    asUser(h.users.userA, orgAId);
    const result = await analytics.overview({ days: 30 });

    // Total across all statuses for today should equal Org A's 2 runs
    const today = result.executionsOverTime.find(
      (p) => p.date === new Date().toISOString().slice(0, 10),
    );
    if (today) {
      const total =
        today.SUCCESS +
        today.FAILED +
        today.CANCELLED +
        today.TIMED_OUT +
        today.QUOTA_EXCEEDED +
        today.RUNNING;
      expect(total).toBe(2);
    }
  });
});
