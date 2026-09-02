import { createId } from "@paralleldrive/cuid2";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { updatePlanFromWebhook } from "@/lib/auth-webhooks";
import prisma from "@/lib/db";

/**
 * Guarded like every other integration suite: without TEST_DATABASE_URL there
 * is no test database to talk to, and running anyway would mean creating and
 * deleting users and organizations in whatever DATABASE_URL points at.
 */
const hasDb = Boolean(process.env.TEST_DATABASE_URL);

describe.runIf(hasDb)("Polar webhooks", () => {
  let userId: string;
  let orgId: string;

  beforeEach(async () => {
    userId = createId();
    orgId = createId();

    await prisma.user.create({
      data: {
        id: userId,
        email: `${userId}@example.com`,
        name: "Test User",
      },
    });

    await prisma.organization.create({
      data: {
        id: orgId,
        name: "Test Org",
        slug: orgId,
        plan: "FREE",
        members: {
          create: {
            userId,
            role: "OWNER",
          },
        },
      },
    });
  });

  afterEach(async () => {
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("upgrades plan and logs audit event", async () => {
    // 287c0566-c317-491b-b804-c118a4fdab0f is PRO
    await updatePlanFromWebhook(
      userId,
      "287c0566-c317-491b-b804-c118a4fdab0f",
      false,
    );

    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    expect(org?.plan).toBe("PRO");

    const audit = await prisma.auditLog.findFirst({
      where: { organizationId: orgId, action: "organization.update_plan" },
    });
    expect(audit).toBeDefined();
    expect(audit?.after).toMatchObject({ plan: "PRO" });
    expect(audit?.before).toMatchObject({ plan: "FREE" });
  });

  it("is idempotent when redelivered", async () => {
    // First delivery
    await updatePlanFromWebhook(
      userId,
      "287c0566-c317-491b-b804-c118a4fdab0f",
      false,
    );

    const countBefore = await prisma.auditLog.count({
      where: { organizationId: orgId, action: "organization.update_plan" },
    });
    expect(countBefore).toBe(1);

    // Redelivery
    await updatePlanFromWebhook(
      userId,
      "287c0566-c317-491b-b804-c118a4fdab0f",
      false,
    );

    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    expect(org?.plan).toBe("PRO"); // Stays PRO

    const countAfter = await prisma.auditLog.count({
      where: { organizationId: orgId, action: "organization.update_plan" },
    });
    expect(countAfter).toBe(1); // No new audit log
  });

  it("downgrades to FREE on cancellation", async () => {
    // Setup to PRO
    await updatePlanFromWebhook(
      userId,
      "287c0566-c317-491b-b804-c118a4fdab0f",
      false,
    );
    let org = await prisma.organization.findUnique({ where: { id: orgId } });
    expect(org?.plan).toBe("PRO");

    // Cancel
    await updatePlanFromWebhook(
      userId,
      "287c0566-c317-491b-b804-c118a4fdab0f",
      true,
    );

    org = await prisma.organization.findUnique({ where: { id: orgId } });
    expect(org?.plan).toBe("FREE");

    const countAfter = await prisma.auditLog.count({
      where: { organizationId: orgId, action: "organization.update_plan" },
    });
    expect(countAfter).toBe(2); // Initial upgrade + downgrade
  });

  it("ignores unknown product IDs silently granting a plan", async () => {
    await updatePlanFromWebhook(userId, "unknown-product-id", false);

    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    expect(org?.plan).toBe("FREE"); // remains FREE

    const count = await prisma.auditLog.count({
      where: { organizationId: orgId, action: "organization.update_plan" },
    });
    expect(count).toBe(0); // no audit log
  });
});
