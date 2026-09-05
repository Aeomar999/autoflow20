import { describe, expect, it, vi } from "vitest";
import { executionsRouter } from "@/features/executions/server/routers";
import prisma from "@/lib/db";
import type { createTRPCContext } from "@/trpc/init";

/**
 * Executions list org isolation (AF-UX-01).
 *
 * The executions page now filters by a free-text search (matched against the
 * execution id and workflow name) and by a multi-select of workflow ids. Both
 * live on the `workflow` relation, so a missing org guard on either filter
 * lets org A enumerate org B's runs — the most damaging case is typing a name:
 * a broad term surfaces another tenant's execution history. Every filter below
 * must be scoped to `ctx.org.id`, verified both by absence (B's rows never
 * appear for A) and by presence (A's identically-named rows still do, so a
 * passing test cannot be a query that returns nothing).
 */
const h = vi.hoisted(() => {
  const userA = { id: "user_exa", email: "exa@test.local", name: "Exa" };
  const userB = { id: "user_exb", email: "exb@test.local", name: "Exb" };
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

/** Both orgs' workflows use the SAME name, so only scoping can tell runs apart. */
const SHARED_NAME = "Quarterly revenue sync";

describe.runIf(hasDb)("Executions router org isolation", () => {
  const mockCtx = {} as unknown as ReturnType<typeof createTRPCContext>;
  const executions = executionsRouter.createCaller(mockCtx);

  function asUser(user: { id: string; email: string; name: string }) {
    h.currentUser = { ...user };
    h.headerMap.clear();
  }

  async function seed() {
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE "organization","member","invitation","workspace","WorkflowVersion","NodeExecution","Execution","Connection","Node","Workflow","Credential","user","session","account","verification" CASCADE`,
    );
    await prisma.user.createMany({ data: [h.users.userA, h.users.userB] });

    const orgA = await prisma.organization.create({
      data: {
        name: "Org A Executions",
        slug: "orga-executions",
        members: { create: { userId: h.users.userA.id, role: "OWNER" } },
      },
      select: { id: true },
    });
    const orgB = await prisma.organization.create({
      data: {
        name: "Org B Executions",
        slug: "orgb-executions",
        members: { create: { userId: h.users.userB.id, role: "OWNER" } },
      },
      select: { id: true },
    });

    const [wfA, wfB] = await Promise.all([
      prisma.workflow.create({
        data: {
          name: SHARED_NAME,
          userId: h.users.userA.id,
          organizationId: orgA.id,
        },
        select: { id: true },
      }),
      prisma.workflow.create({
        data: {
          name: SHARED_NAME,
          userId: h.users.userB.id,
          organizationId: orgB.id,
        },
        select: { id: true },
      }),
    ]);

    const [execA, execB] = await Promise.all([
      prisma.execution.create({
        data: {
          workflowId: wfA.id,
          trigger: "MANUAL",
          mode: "PRODUCTION",
          status: "FAILED",
          inngestEventId: "evt_exa_01",
          organizationId: orgA.id,
          startedAt: new Date(),
        },
        select: { id: true },
      }),
      prisma.execution.create({
        data: {
          workflowId: wfB.id,
          trigger: "MANUAL",
          mode: "PRODUCTION",
          status: "SUCCESS",
          inngestEventId: "evt_exb_01",
          organizationId: orgB.id,
          startedAt: new Date(),
        },
        select: { id: true },
      }),
    ]);

    return { wfA, wfB, execA, execB };
  }

  it("finds a run by workflow name without crossing orgs", async () => {
    const { execA, execB } = await seed();

    asUser(h.users.userA);
    const forA = await executions.list({ search: SHARED_NAME });
    expect(forA.items.map((r) => r.id)).toEqual([execA.id]);

    asUser(h.users.userB);
    const forB = await executions.list({ search: SHARED_NAME });
    expect(forB.items.map((r) => r.id)).toEqual([execB.id]);
  });

  it("does not leak another org's runs on an open list", async () => {
    // No search and no workflowIds — the ONLY thing standing between the
    // caller and every run in the table is the org scope.
    const { execA } = await seed();

    asUser(h.users.userA);
    const results = await executions.list({});
    expect(results.items.map((r) => r.id)).toEqual([execA.id]);
    expect(results.totalCount).toBe(1);
  });

  it("never returns another org's run when filtered by its workflowId", async () => {
    const { wfA, wfB, execA } = await seed();

    asUser(h.users.userA);
    // Filtering by ONLY org B's workflow: the org guard must empty the set,
    // not silently widen the filter.
    const onlyForeign = await executions.list({ workflowIds: [wfB.id] });
    expect(onlyForeign.items.map((r) => r.id)).toEqual([]);
    expect(onlyForeign.totalCount).toBe(0);

    // Filtering by BOTH orgs' workflows: only A's own run can come back.
    const mixed = await executions.list({
      workflowIds: [wfA.id, wfB.id],
    });
    expect(mixed.items.map((r) => r.id)).toEqual([execA.id]);
  });

  it("finds a run by the start of its id without crossing orgs", async () => {
    const { execA, execB } = await seed();

    asUser(h.users.userA);
    const forA = await executions.list({ search: execA.id });
    expect(forA.items.map((r) => r.id)).toEqual([execA.id]);

    // Searching for org B's id from org A must return nothing. Use the FULL
    // id: two cuid2s created in the same millisecond share an identical
    // ~8-char prefix (timestamp + counter), so a short `startsWith` slice
    // would falsely match — and falsely fail — the isolation assertion.
    const fromAForeignId = await executions.list({ search: execB.id });
    expect(fromAForeignId.items.map((r) => r.id)).toEqual([]);

    asUser(h.users.userB);
    const forB = await executions.list({ search: execB.id });
    expect(forB.items.map((r) => r.id)).toEqual([execB.id]);
  });

  it("combines search and workflowIds within the tenant", async () => {
    const { wfA, wfB, execA } = await seed();

    asUser(h.users.userA);
    // Broad search (shared name) + a foreign workflowId → nothing, even though
    // the search term alone would match a name in org B.
    const crossOrg = await executions.list({
      search: SHARED_NAME,
      workflowIds: [wfB.id],
    });
    expect(crossOrg.items.map((r) => r.id)).toEqual([]);

    // Same search + own workflowId → own run only.
    const ownOrg = await executions.list({
      search: SHARED_NAME,
      workflowIds: [wfA.id],
    });
    expect(ownOrg.items.map((r) => r.id)).toEqual([execA.id]);
  });
});
