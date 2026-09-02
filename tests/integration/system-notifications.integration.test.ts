import { beforeEach, describe, expect, it } from "vitest";
import {
  broadcastSystemNotification,
  previewSystemBroadcast,
} from "@/features/notifications/server/system-notifier";
import prisma from "@/lib/db";

/**
 * AF-M8-13 against a real Postgres. The property that matters is idempotency:
 * a broadcast reaches hundreds of workspaces, so a half-failed run must be
 * safe to simply repeat. That is enforced by a unique index, which only a real
 * database can prove.
 */

const hasDb = Boolean(process.env.TEST_DATABASE_URL);

describe.runIf(hasDb)("system announcements (AF-M8-13)", () => {
  let orgA: string;
  let orgB: string;

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE "Notification","AiResponseCache","organization","member","invitation","workspace","WorkflowVersion","NodeExecution","Execution","Connection","Node","Workflow","Credential","user","session","account","verification" CASCADE`,
    );

    orgA = (
      await prisma.organization.create({
        data: { name: "Org A", slug: "sys-org-a" },
      })
    ).id;
    orgB = (
      await prisma.organization.create({
        data: { name: "Org B", slug: "sys-org-b" },
      })
    ).id;
  });

  const announcement = {
    announcementId: "maint-2026-09-14",
    title: "Scheduled maintenance on 14 September",
    message: "Runs will queue for about 20 minutes from 02:00 UTC.",
  };

  it("reaches every workspace when no target is given", async () => {
    const result = await broadcastSystemNotification(announcement);

    expect(result).toEqual({ targeted: 2, written: 2, skipped: 0 });

    for (const organizationId of [orgA, orgB]) {
      const row = await prisma.notification.findFirst({
        where: { organizationId },
      });
      expect(row?.type).toBe("SYSTEM");
      expect(row?.title).toBe(announcement.title);
      expect(row?.readAt).toBeNull();
    }
  });

  it("writes no originating ids, because a system notice has none", async () => {
    await broadcastSystemNotification(announcement);

    const row = await prisma.notification.findFirstOrThrow({
      where: { organizationId: orgA },
    });
    expect(row.workflowId).toBeNull();
    expect(row.executionId).toBeNull();
    expect(row.credentialId).toBeNull();
  });

  it("is idempotent - re-running writes nothing and announces nothing twice", async () => {
    await broadcastSystemNotification(announcement);
    const second = await broadcastSystemNotification(announcement);

    expect(second).toEqual({ targeted: 2, written: 0, skipped: 2 });
    expect(await prisma.notification.count()).toBe(2);
  });

  it("re-running after a partial broadcast reaches only the workspaces that missed it", async () => {
    // Simulate a run that got through org A and then died.
    await broadcastSystemNotification({
      ...announcement,
      organizationIds: [orgA],
    });

    const resumed = await broadcastSystemNotification(announcement);

    expect(resumed).toEqual({ targeted: 2, written: 1, skipped: 1 });
    expect(await prisma.notification.count()).toBe(2);
    expect(
      await prisma.notification.count({ where: { organizationId: orgB } }),
    ).toBe(1);
  });

  it("keeps the announcement out of workspaces it was not addressed to", async () => {
    await broadcastSystemNotification({
      ...announcement,
      organizationIds: [orgA],
    });

    expect(
      await prisma.notification.count({ where: { organizationId: orgB } }),
    ).toBe(0);
  });

  it("treats a different announcement id as a genuinely new announcement", async () => {
    await broadcastSystemNotification(announcement);
    const next = await broadcastSystemNotification({
      ...announcement,
      announcementId: "incident-2026-09-20",
      title: "Degraded execution throughput",
    });

    expect(next.written).toBe(2);
    expect(await prisma.notification.count()).toBe(4);
  });

  it("stores an in-app link when one is given", async () => {
    await broadcastSystemNotification({ ...announcement, href: "/status" });

    const row = await prisma.notification.findFirstOrThrow({
      where: { organizationId: orgA },
    });
    expect(row.href).toBe("/status");
  });

  it("does nothing when there are no organizations", async () => {
    await prisma.organization.deleteMany();

    expect(await broadcastSystemNotification(announcement)).toEqual({
      targeted: 0,
      written: 0,
      skipped: 0,
    });
  });

  /**
   * The dry run is what the operator decides on before sending, so its numbers
   * have to match what a real send would do - and it must not write.
   */
  describe("previewSystemBroadcast", () => {
    it("predicts a first send without writing anything", async () => {
      const preview = await previewSystemBroadcast(announcement);

      expect(preview).toEqual({ targeted: 2, pending: 2, skipped: 0 });
      expect(await prisma.notification.count()).toBe(0);
    });

    it("predicts exactly what the send then does", async () => {
      const preview = await previewSystemBroadcast(announcement);
      const sent = await broadcastSystemNotification(announcement);

      expect(sent.written).toBe(preview.pending);
      expect(sent.targeted).toBe(preview.targeted);
    });

    it("reports nothing pending once everyone has it", async () => {
      await broadcastSystemNotification(announcement);

      expect(await previewSystemBroadcast(announcement)).toEqual({
        targeted: 2,
        pending: 0,
        skipped: 2,
      });
    });

    it("counts only the workspaces that missed a partial broadcast", async () => {
      await broadcastSystemNotification({
        ...announcement,
        organizationIds: [orgA],
      });

      expect(await previewSystemBroadcast(announcement)).toEqual({
        targeted: 2,
        pending: 1,
        skipped: 1,
      });
    });

    it("honours an organization filter", async () => {
      expect(
        await previewSystemBroadcast({
          ...announcement,
          organizationIds: [orgA],
        }),
      ).toEqual({ targeted: 1, pending: 1, skipped: 0 });
    });
  });
});
