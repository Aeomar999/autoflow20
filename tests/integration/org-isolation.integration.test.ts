import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { credentialsRouter } from "@/features/credentials/server/routers";
import { executionsRouter } from "@/features/executions/server/routers";
import { workflowsRouter } from "@/features/workflows/server/routers";
import type { ExecutionStatus } from "@/generated/prisma/client";
import prisma from "@/lib/db";
import { COUNTABLE_EXECUTION_STATUSES } from "@/lib/quotas";
import type { createTRPCContext } from "@/trpc/init";

/**
 * Org isolation (AF-M7-pre-1): proves workflows, executions, and credentials
 * are scoped to the active organization per `resolveActiveOrg`, including
 * that a caller cannot read or write another org's rows — even by spoofing
 * the `x-organization-id` header.
 *
 * The org middleware resolves the session from the mocked `auth.api.getSession`
 * and the org from the mocked `next/headers` + seeded memberships on every
 * call, so a bare `{}` context is sufficient (mirrors the versioning test).
 * Session users must own an org + OWNER membership so resolution never falls
 * into the personal-org-creation fallback (which builds a slug from email/name
 * and would crash on this mocked session shape).
 */
const h = vi.hoisted(() => {
  const userA = { id: "user_orga", email: "a@test.local", name: "User A" };
  const userB = { id: "user_orgb", email: "b@test.local", name: "User B" };
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

describe.runIf(hasDb)("Org isolation", () => {
  const mockCtx = {} as unknown as ReturnType<typeof createTRPCContext>;
  const workflows = workflowsRouter.createCaller(mockCtx);
  const executions = executionsRouter.createCaller(mockCtx);
  const credentials = credentialsRouter.createCaller(mockCtx);

  let orgAId: string;
  let orgBId: string;
  let wfAId: string;
  let wfBId: string;
  let wfBVersionId: string;
  let wfBRevision: number;
  let exAId: string;
  let exBId: string;
  let credAId: string;
  let credBId: string;

  beforeAll(() => {
    // Premium bypass: the only real Polar-free path for workflow/credential
    // create in tests (src/trpc/init.ts resolvePremiumCustomer).
    process.env.E2E_SERVER = "1";
  });

  afterAll(() => {
    delete process.env.E2E_SERVER;
  });

  /** Switch the "signed-in" user; optionally spoof an org header. */
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
        name: "Org A",
        slug: "orga-integration",
        members: { create: { userId: h.users.userA.id, role: "OWNER" } },
      },
      select: { id: true },
    });
    const orgB = await prisma.organization.create({
      data: {
        name: "Org B",
        slug: "orgb-integration",
        members: { create: { userId: h.users.userB.id, role: "OWNER" } },
      },
      select: { id: true },
    });
    orgAId = orgA.id;
    orgBId = orgB.id;

    const wfA = await prisma.workflow.create({
      data: { name: "wf-a", userId: h.users.userA.id, organizationId: orgA.id },
      select: { id: true, revision: true },
    });
    const wfB = await prisma.workflow.create({
      data: { name: "wf-b", userId: h.users.userB.id, organizationId: orgB.id },
      select: { id: true, revision: true },
    });
    wfAId = wfA.id;
    wfBId = wfB.id;
    wfBRevision = wfB.revision;

    const wfBVersion = await prisma.workflowVersion.create({
      data: {
        workflow: { connect: { id: wfB.id } },
        version: 1,
        workflowRevision: wfB.revision,
        graphSnapshot: {},
      },
      select: { id: true },
    });
    wfBVersionId = wfBVersion.id;

    const exA = await prisma.execution.create({
      data: {
        workflowId: wfA.id,
        trigger: "MANUAL",
        mode: "PRODUCTION",
        status: "SUCCESS",
        inngestEventId: "evt_orga_01",
        organizationId: orgA.id,
      },
      select: { id: true },
    });
    const exB = await prisma.execution.create({
      data: {
        workflowId: wfB.id,
        trigger: "MANUAL",
        mode: "PRODUCTION",
        status: "SUCCESS",
        inngestEventId: "evt_orgb_01",
        organizationId: orgB.id,
      },
      select: { id: true },
    });
    exAId = exA.id;
    exBId = exB.id;

    // Credentials go through the real router path so the envelope columns are
    // produced by vault.ts (not hand-fabricated) and the org wiring on create
    // is exercised.
    asUser(h.users.userA);
    const credA = await credentials.create({
      name: "cred-a",
      type: "openai.apiKey",
      apiKey: "sk-test-a",
    });
    asUser(h.users.userB);
    const credB = await credentials.create({
      name: "cred-b",
      type: "openai.apiKey",
      apiKey: "sk-test-b",
    });
    credAId = credA.id;
    credBId = credB.id;
  });

  it("scopes workflow lists to the caller's own org", async () => {
    asUser(h.users.userA);
    const listA = await workflows.getMany({});
    expect(listA.totalCount).toBe(1);
    expect(listA.items[0].id).toBe(wfAId);

    asUser(h.users.userB);
    const listB = await workflows.getMany({});
    expect(listB.totalCount).toBe(1);
    expect(listB.items[0].id).toBe(wfBId);
  });

  it("rejects cross-org workflow reads", async () => {
    asUser(h.users.userA);
    await expect(workflows.getOne({ id: wfBId })).rejects.toThrow();
    await expect(workflows.getVersions({ id: wfBId })).rejects.toThrow();

    asUser(h.users.userB);
    await expect(workflows.getOne({ id: wfAId })).rejects.toThrow();
  });

  it("rejects cross-org workflow writes", async () => {
    asUser(h.users.userA);
    await expect(
      workflows.saveGraph({
        id: wfBId,
        nodes: [],
        edges: [],
        revision: wfBRevision,
      }),
    ).rejects.toThrow();
    await expect(
      workflows.updateName({ id: wfBId, name: "hacked" }),
    ).rejects.toThrow();
    await expect(workflows.publish({ id: wfBId })).rejects.toThrow();
    await expect(
      workflows.activate({ workflowId: wfBId, versionId: wfBVersionId }),
    ).rejects.toThrow();
    await expect(workflows.deactivate({ id: wfBId })).rejects.toThrow();
    await expect(workflows.run({ id: wfBId })).rejects.toThrow();
    await expect(workflows.remove({ id: wfBId })).rejects.toThrow();

    // The targeted workflow is untouched.
    const untouched = await prisma.workflow.findUnique({
      where: { id: wfBId },
      select: { name: true, revision: true },
    });
    expect(untouched).toEqual({ name: "wf-b", revision: wfBRevision });
  });

  it("does not honour a spoofed org header for another org's rows", async () => {
    asUser(h.users.userA, orgBId);
    // userA has no membership in orgB, so resolveActiveOrg falls back to orgA;
    // reads AND writes to orgB's workflow still fail.
    await expect(workflows.getOne({ id: wfBId })).rejects.toThrow();
    await expect(
      workflows.updateName({ id: wfBId, name: "hacked" }),
    ).rejects.toThrow();
  });

  it("scopes execution list reads per org and rejects cross-org actions", async () => {
    asUser(h.users.userA);
    const listA = await executions.list({});
    expect(listA.items).toHaveLength(1);
    expect(listA.items[0].id).toBe(exAId);
    await expect(executions.getOne({ id: exBId })).rejects.toThrow();
    await expect(executions.cancel({ id: exBId })).rejects.toThrow();
    await expect(executions.retry({ id: exBId })).rejects.toThrow();

    asUser(h.users.userB);
    const listB = await executions.list({});
    expect(listB.items).toHaveLength(1);
    expect(listB.items[0].id).toBe(exBId);
  });

  it("scopes credential reads per org and rejects cross-org reads", async () => {
    asUser(h.users.userA);
    const listA = await credentials.list({});
    expect(listA.items).toHaveLength(1);
    expect(listA.items[0].id).toBe(credAId);
    await expect(credentials.getOne({ id: credBId })).rejects.toThrow();

    asUser(h.users.userB);
    const listB = await credentials.list({});
    expect(listB.items).toHaveLength(1);
    expect(listB.items[0].id).toBe(credBId);
    await expect(credentials.getOne({ id: credAId })).rejects.toThrow();
  });

  it("assigns workflow and credential creates to the active org, even when another org's header is spoofed", async () => {
    asUser(h.users.userA, orgBId);
    const wf = await workflows.create();
    const wfRow = await prisma.workflow.findUnique({
      where: { id: wf.id },
      select: { organizationId: true },
    });
    expect(wfRow?.organizationId).toBe(orgAId);

    const cred = await credentials.create({
      name: "cred-a2",
      type: "openai.apiKey",
      apiKey: "sk-test-a2",
    });
    const credRow = await prisma.credential.findUnique({
      where: { id: cred.id },
      select: { organizationId: true },
    });
    expect(credRow?.organizationId).toBe(orgAId);
  });

  it("leaves owners able to mutate their own workflows", async () => {
    asUser(h.users.userB);
    await workflows.updateName({ id: wfBId, name: "renamed-by-owner" });
    const wf = await workflows.getOne({ id: wfBId });
    expect(wf.name).toBe("renamed-by-owner");
  });

  // AF-M7-04: the run-gate count kernel, exercised against the same seeded
  // rows above, must be tenant-scoped exactly like the router queries. This is
  // the same where-shape the runner uses (COUNTABLE_EXECUTION_STATUSES +
  // start-of-month window on organizationId).
  const countableIn = [...COUNTABLE_EXECUTION_STATUSES] as ExecutionStatus[];
  const monthStart = () => {
    const d = new Date();
    d.setUTCDate(1);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  };
  const gateCount = (organizationId: string) =>
    prisma.execution.count({
      where: {
        organizationId,
        status: { in: countableIn },
        startedAt: { gte: monthStart() },
      },
    });

  it("counts each org's countable executions independently", async () => {
    // The seeded rows give orgA and orgB exactly one countable execution each.
    expect(await gateCount(orgAId)).toBe(1);
    expect(await gateCount(orgBId)).toBe(1);
  });

  it("never lets a QUOTA_EXCEEDED refusal or TEST run inflate the count", async () => {
    await prisma.execution.create({
      data: {
        workflowId: wfAId,
        trigger: "MANUAL",
        mode: "PRODUCTION",
        status: "QUOTA_EXCEEDED",
        inngestEventId: "evt_gate_a_refused",
        organizationId: orgAId,
      },
    });
    await prisma.execution.create({
      data: {
        workflowId: wfAId,
        trigger: "TEST",
        mode: "TEST",
        status: "RUNNING",
        inngestEventId: "evt_gate_a_test",
        organizationId: orgAId,
      },
    });
    expect(await gateCount(orgAId)).toBe(1);
  });

  it("only counts executions from the current calendar month", async () => {
    const lastMonth = monthStart();
    lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1);
    await prisma.execution.create({
      data: {
        workflowId: wfAId,
        trigger: "MANUAL",
        mode: "PRODUCTION",
        status: "SUCCESS",
        startedAt: lastMonth,
        inngestEventId: "evt_gate_a_old_month",
        organizationId: orgAId,
      },
    });
    expect(await gateCount(orgAId)).toBe(1);
  });
});
