import { describe, expect, it, vi } from "vitest";
import { searchRouter } from "@/features/search/server/routers";
import prisma from "@/lib/db";
import type { createTRPCContext } from "@/trpc/init";

/**
 * Command palette search org isolation (AF-M7-07).
 *
 * The palette searches by name across three tables at once, which makes it the
 * easiest place in the product to leak another tenant's data — one missing
 * `where` clause and org A can enumerate org B's workflow, run, and credential
 * names by typing letters. This proves each of the three is scoped, both by
 * absence (B's rows never appear for A) and by presence (A's own identically
 * named rows still do, so a passing test cannot be a query that returns
 * nothing).
 */
const h = vi.hoisted(() => {
  const userA = { id: "user_sea", email: "sea@test.local", name: "Sea" };
  const userB = { id: "user_seb", email: "seb@test.local", name: "Seb" };
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

/** Both orgs use the SAME name, so only scoping can tell the rows apart. */
const SHARED_NAME = "Quarterly revenue sync";

describe.runIf(hasDb)("Search router org isolation", () => {
  const mockCtx = {} as unknown as ReturnType<typeof createTRPCContext>;
  const search = searchRouter.createCaller(mockCtx);

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
        name: "Org A Search",
        slug: "orga-search",
        members: { create: { userId: h.users.userA.id, role: "OWNER" } },
      },
      select: { id: true },
    });
    const orgB = await prisma.organization.create({
      data: {
        name: "Org B Search",
        slug: "orgb-search",
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
          inngestEventId: "evt_sea_01",
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
          status: "FAILED",
          inngestEventId: "evt_seb_01",
          organizationId: orgB.id,
          startedAt: new Date(),
        },
        select: { id: true },
      }),
    ]);

    const credentialBytes = {
      ciphertext: Buffer.from("ct"),
      iv: Buffer.from("iv"),
      authTag: Buffer.from("tag"),
      wrappedDek: Buffer.from("dek"),
    };
    const [credA, credB] = await Promise.all([
      prisma.credential.create({
        data: {
          name: SHARED_NAME,
          type: "openai.apiKey",
          userId: h.users.userA.id,
          organizationId: orgA.id,
          ...credentialBytes,
        },
        select: { id: true },
      }),
      prisma.credential.create({
        data: {
          name: SHARED_NAME,
          type: "openai.apiKey",
          userId: h.users.userB.id,
          organizationId: orgB.id,
          ...credentialBytes,
        },
        select: { id: true },
      }),
    ]);

    return { wfA, wfB, execA, execB, credA, credB };
  }

  it("returns only the caller's own workflows", async () => {
    const { wfA, wfB } = await seed();

    asUser(h.users.userA);
    const forA = await search.query({ q: SHARED_NAME, limit: 5 });
    expect(forA.workflows.map((r) => r.id)).toEqual([wfA.id]);

    asUser(h.users.userB);
    const forB = await search.query({ q: SHARED_NAME, limit: 5 });
    expect(forB.workflows.map((r) => r.id)).toEqual([wfB.id]);
  });

  it("returns only the caller's own executions", async () => {
    const { execA, execB } = await seed();

    asUser(h.users.userA);
    const forA = await search.query({ q: SHARED_NAME, limit: 5 });
    expect(forA.executions.map((r) => r.id)).toEqual([execA.id]);

    asUser(h.users.userB);
    const forB = await search.query({ q: SHARED_NAME, limit: 5 });
    expect(forB.executions.map((r) => r.id)).toEqual([execB.id]);
  });

  it("returns only the caller's own credentials", async () => {
    const { credA, credB } = await seed();

    asUser(h.users.userA);
    const forA = await search.query({ q: SHARED_NAME, limit: 5 });
    expect(forA.credentials.map((r) => r.id)).toEqual([credA.id]);

    asUser(h.users.userB);
    const forB = await search.query({ q: SHARED_NAME, limit: 5 });
    expect(forB.credentials.map((r) => r.id)).toEqual([credB.id]);
  });

  it("does not leak another org's rows on an empty query", async () => {
    // An empty query is the browse case — no `contains` filter at all, so the
    // ONLY thing standing between the caller and every row in the table is
    // the org scope.
    const { wfA, execA, credA } = await seed();

    asUser(h.users.userA);
    const results = await search.query({ q: "", limit: 20 });

    expect(results.workflows.map((r) => r.id)).toEqual([wfA.id]);
    expect(results.executions.map((r) => r.id)).toEqual([execA.id]);
    expect(results.credentials.map((r) => r.id)).toEqual([credA.id]);
  });

  it("finds a run by status without crossing orgs", async () => {
    const { execA } = await seed();

    asUser(h.users.userA);
    const results = await search.query({ q: "failed", limit: 5 });
    expect(results.executions.map((r) => r.id)).toEqual([execA.id]);
  });

  it("finds a run by the start of its id", async () => {
    const { execA } = await seed();

    asUser(h.users.userA);
    const results = await search.query({
      q: execA.id.slice(0, 8),
      limit: 5,
    });
    expect(results.executions.map((r) => r.id)).toEqual([execA.id]);
  });

  it("never returns credential secret material", async () => {
    // There is no read path for a credential's secret, for anyone, ever — and
    // a global search box is exactly where an accidental one would surface.
    await seed();

    asUser(h.users.userA);
    const results = await search.query({ q: SHARED_NAME, limit: 5 });

    const serialized = JSON.stringify(results.credentials);
    for (const forbidden of [
      "ciphertext",
      "iv",
      "authTag",
      "wrappedDek",
      "preview",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("respects the per-kind limit", async () => {
    const { wfA } = await seed();
    void wfA;

    asUser(h.users.userA);
    const results = await search.query({ q: "", limit: 1 });
    expect(results.workflows.length).toBeLessThanOrEqual(1);
    expect(results.executions.length).toBeLessThanOrEqual(1);
    expect(results.credentials.length).toBeLessThanOrEqual(1);
  });
});
