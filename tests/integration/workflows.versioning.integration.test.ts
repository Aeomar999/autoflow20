import { beforeEach, describe, expect, it, vi } from "vitest";
import { workflowsRouter } from "@/features/workflows/server/routers";
import { Prisma } from "@/generated/prisma/client";
import prisma from "@/lib/db";
import type { createTRPCContext } from "@/trpc/init";

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: vi.fn().mockResolvedValue({ user: { id: "user_v1" }, session: {} }),
    },
  },
}));
vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Map()),
}));

const dbUrl = process.env.TEST_DATABASE_URL;
const hasDb = Boolean(dbUrl);

describe.runIf(hasDb)("Workflows Router Versioning", () => {
  const user = { id: "user_v1", email: "v1@test.local", name: "V1 User", emailVerified: true };
  const mockCtx = {} as unknown as ReturnType<typeof createTRPCContext>;

  const caller = workflowsRouter.createCaller(mockCtx);
  let wfId: string;

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE "WorkflowVersion","NodeExecution","Execution","Connection","Node","Workflow","Credential","user","session","account","verification" CASCADE`,
    );

    await prisma.user.create({ data: user });
    const wf = await prisma.workflow.create({
      data: {
        name: "Test WF",
        userId: user.id,
        nodes: {
          create: {
            type: "MANUAL_TRIGGER",
            position: { x: 0, y: 0 },
            name: "MANUAL_TRIGGER",
          },
        },
      }
    });
    wfId = wf.id;
  });

  it("should publish a new version and activate it by default", async () => {
    const version = await caller.publish({ id: wfId });

    expect(version.version).toBe(1);
    expect(version.workflowId).toBe(wfId);
    expect(version.workflowRevision).toBe(0);
    expect((version.graphSnapshot as any).nodes).toHaveLength(1);
    
    const updatedWf = await prisma.workflow.findUnique({
      where: { id: wfId },
    });
    expect(updatedWf?.activeVersionId).toBe(version.id);
  });

  it("should allow publishing without activation", async () => {
    const version = await caller.publish({ id: wfId, activate: false });
    
    expect(version.version).toBe(1);
    const updatedWf = await prisma.workflow.findUnique({
      where: { id: wfId },
    });
    expect(updatedWf?.activeVersionId).toBeNull();
  });

  it("should increment versions and retrieve them", async () => {
    const v1 = await caller.publish({ id: wfId });
    
    await prisma.workflow.update({
      where: { id: wfId },
      data: { revision: { increment: 1 } },
    });

    const v2 = await caller.publish({ id: wfId });

    expect(v1.version).toBe(1);
    expect(v2.version).toBe(2);
    expect(v2.workflowRevision).toBe(1);

    const result = await caller.getVersions({ id: wfId });
    expect(result.activeVersionId).toBe(v2.id);
    expect(result.versions).toHaveLength(2);
    expect(result.versions[0].id).toBe(v2.id);
    expect(result.versions[1].id).toBe(v1.id);
  });

  it("should support deactivation", async () => {
    const version = await caller.publish({ id: wfId });
    await caller.deactivate({ id: wfId });

    const updatedWf = await prisma.workflow.findUnique({
      where: { id: wfId },
    });
    expect(updatedWf?.activeVersionId).toBeNull();
  });

  it("should support activating a specific older version", async () => {
    const v1 = await caller.publish({ id: wfId });
    const v2 = await caller.publish({ id: wfId });

    await caller.activate({ workflowId: wfId, versionId: v1.id });

    const updatedWf = await prisma.workflow.findUnique({
      where: { id: wfId },
    });
    expect(updatedWf?.activeVersionId).toBe(v1.id);
  });
});
