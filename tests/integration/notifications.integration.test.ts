import { describe, expect, it, vi } from "vitest";
import { buildExecutionNotification } from "@/features/notifications/lib/build";
import { writeNotifications } from "@/features/notifications/server/notify";
import { notificationsRouter } from "@/features/notifications/server/routers";
import prisma from "@/lib/db";
import type { createTRPCContext } from "@/trpc/init";

/**
 * Notification centre (AF-M7-08): tenant scoping and replay-safety.
 *
 * Two properties are worth a real database rather than a mock. First, that org
 * B never sees or mutates org A's rows — including `markRead`, which writes.
 * Second, that the `dedupeKey` unique index actually makes a replayed write a
 * no-op: that is the guarantee the runner tail and the cron both lean on, and
 * it lives in the schema, so only Postgres can confirm it.
 */
const h = vi.hoisted(() => {
  const userA = { id: "user_nfa", email: "nfa@test.local", name: "Nfa" };
  const userB = { id: "user_nfb", email: "nfb@test.local", name: "Nfb" };
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

describe.runIf(hasDb)("Notification centre", () => {
  const mockCtx = {} as unknown as ReturnType<typeof createTRPCContext>;
  const notifications = notificationsRouter.createCaller(mockCtx);

  function asUser(user: { id: string; email: string; name: string }) {
    h.currentUser = { ...user };
    h.headerMap.clear();
  }

  async function seed() {
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE "organization","member","invitation","workspace","Notification","WorkflowVersion","NodeExecution","Execution","Connection","Node","Workflow","Credential","user","session","account","verification" CASCADE`,
    );
    await prisma.user.createMany({ data: [h.users.userA, h.users.userB] });

    const orgA = await prisma.organization.create({
      data: {
        name: "Org A Notify",
        slug: "orga-notify",
        members: { create: { userId: h.users.userA.id, role: "OWNER" } },
      },
      select: { id: true },
    });
    const orgB = await prisma.organization.create({
      data: {
        name: "Org B Notify",
        slug: "orgb-notify",
        members: { create: { userId: h.users.userB.id, role: "OWNER" } },
      },
      select: { id: true },
    });

    await prisma.notification.createMany({
      data: [
        {
          organizationId: orgA.id,
          type: "EXECUTION_FAILED",
          title: "Org A run failed",
          message: "boom",
          dedupeKey: "seed:a:1",
        },
        {
          organizationId: orgA.id,
          type: "CREDENTIAL_EXPIRING",
          title: "Org A credential expiring",
          message: "soon",
          dedupeKey: "seed:a:2",
          readAt: new Date(),
        },
        {
          organizationId: orgB.id,
          type: "EXECUTION_FAILED",
          title: "Org B run failed",
          message: "boom",
          dedupeKey: "seed:b:1",
        },
      ],
    });

    // Real workflows: `Notification.workflowId` is a real FK, so a fabricated
    // id is rejected by Postgres and — because `writeNotifications` swallows
    // its own errors by design — would silently write nothing.
    const [wfA, wfB] = await Promise.all([
      prisma.workflow.create({
        data: {
          name: "Org A workflow",
          userId: h.users.userA.id,
          organizationId: orgA.id,
        },
        select: { id: true },
      }),
      prisma.workflow.create({
        data: {
          name: "Org B workflow",
          userId: h.users.userB.id,
          organizationId: orgB.id,
        },
        select: { id: true },
      }),
    ]);

    return { orgA, orgB, wfA, wfB };
  }

  it("lists only the caller's own workspace", async () => {
    await seed();

    asUser(h.users.userA);
    const forA = await notifications.list({
      filter: "all",
      page: 1,
      pageSize: 20,
    });
    expect(forA.items.map((n) => n.title).sort()).toEqual([
      "Org A credential expiring",
      "Org A run failed",
    ]);

    asUser(h.users.userB);
    const forB = await notifications.list({
      filter: "all",
      page: 1,
      pageSize: 20,
    });
    expect(forB.items.map((n) => n.title)).toEqual(["Org B run failed"]);
  });

  it("counts only the caller's own unread", async () => {
    await seed();

    asUser(h.users.userA);
    // Two rows, one already read.
    expect(await notifications.unreadCount()).toEqual({ count: 1 });

    asUser(h.users.userB);
    expect(await notifications.unreadCount()).toEqual({ count: 1 });
  });

  it("filters to unread", async () => {
    await seed();

    asUser(h.users.userA);
    const unread = await notifications.list({
      filter: "unread",
      page: 1,
      pageSize: 20,
    });
    expect(unread.items.map((n) => n.title)).toEqual(["Org A run failed"]);
  });

  it("refuses to mark another org's notification read", async () => {
    // The write path is where a missing scope does real damage, so it gets its
    // own case: a cross-tenant id must change nothing and must not throw in a
    // way that confirms the row exists.
    const { orgB } = await seed();
    const orgBRow = await prisma.notification.findFirstOrThrow({
      where: { organizationId: orgB.id },
      select: { id: true },
    });

    asUser(h.users.userA);
    const result = await notifications.markRead({ id: orgBRow.id });
    expect(result.updated).toBe(0);

    const after = await prisma.notification.findUniqueOrThrow({
      where: { id: orgBRow.id },
      select: { readAt: true },
    });
    expect(after.readAt).toBeNull();
  });

  it("marks one read", async () => {
    await seed();

    asUser(h.users.userA);
    const before = await notifications.list({
      filter: "unread",
      page: 1,
      pageSize: 20,
    });
    const result = await notifications.markRead({ id: before.items[0].id });

    expect(result.updated).toBe(1);
    expect(await notifications.unreadCount()).toEqual({ count: 0 });
  });

  it("marks all read without touching another org", async () => {
    const { orgB } = await seed();

    asUser(h.users.userA);
    const result = await notifications.markAllRead();
    expect(result.updated).toBe(1);
    expect(await notifications.unreadCount()).toEqual({ count: 0 });

    const orgBUnread = await prisma.notification.count({
      where: { organizationId: orgB.id, readAt: null },
    });
    expect(orgBUnread).toBe(1);
  });

  it("makes a replayed write a no-op", async () => {
    // The guarantee the runner tail and the cron both depend on. Inngest can
    // re-run a step whose memo it lost; the unique dedupeKey is what stops
    // that becoming a second announcement.
    const { orgA, wfA } = await seed();

    const draft = buildExecutionNotification({
      executionId: "exec_replay",
      workflowId: wfA.id,
      workflowName: "Replay me",
      succeeded: false,
      error: "kaboom",
    });

    const first = await writeNotifications(orgA.id, [draft]);
    const second = await writeNotifications(orgA.id, [draft]);

    expect(first).toBe(1);
    expect(second).toBe(0);

    const rows = await prisma.notification.count({
      where: { dedupeKey: draft.dedupeKey },
    });
    expect(rows).toBe(1);
  });

  it("keeps identical events in different orgs distinct", async () => {
    // dedupeKey is globally unique, so two orgs must never be able to collide
    // on one. Execution ids are cuids, so they cannot — this pins that.
    const { orgA, orgB, wfA, wfB } = await seed();

    const forA = buildExecutionNotification({
      executionId: "exec_org_a",
      workflowId: wfA.id,
      workflowName: "Same name",
      succeeded: false,
      error: "boom",
    });
    const forB = buildExecutionNotification({
      executionId: "exec_org_b",
      workflowId: wfB.id,
      workflowName: "Same name",
      succeeded: false,
      error: "boom",
    });

    expect(await writeNotifications(orgA.id, [forA])).toBe(1);
    expect(await writeNotifications(orgB.id, [forB])).toBe(1);
  });

  it("never throws at the caller when the write is rejected", async () => {
    // `writeNotifications` is called from the runner tail and from crons.
    // Failing a user's workflow run because we could not tell them it finished
    // would be absurd, so a rejected write logs and returns 0. This pins that
    // — here via a workflowId that violates the FK, which is the shape a race
    // with a workflow deletion would take.
    const { orgA } = await seed();

    const draft = buildExecutionNotification({
      executionId: "exec_orphan",
      workflowId: "wf_does_not_exist",
      workflowName: "Deleted mid-run",
      succeeded: false,
      error: "boom",
    });

    await expect(writeNotifications(orgA.id, [draft])).resolves.toBe(0);
    expect(
      await prisma.notification.count({
        where: { dedupeKey: draft.dedupeKey },
      }),
    ).toBe(0);
  });

  it("paginates", async () => {
    const { orgA } = await seed();
    await prisma.notification.createMany({
      data: Array.from({ length: 5 }, (_, index) => ({
        organizationId: orgA.id,
        type: "SYSTEM" as const,
        title: `Notice ${index}`,
        message: "x",
        dedupeKey: `seed:page:${index}`,
      })),
    });

    asUser(h.users.userA);
    const page1 = await notifications.list({
      filter: "all",
      page: 1,
      pageSize: 3,
    });

    expect(page1.items).toHaveLength(3);
    expect(page1.totalCount).toBe(7);
    expect(page1.hasNextPage).toBe(true);
    expect(page1.hasPreviousPage).toBe(false);
  });
});
