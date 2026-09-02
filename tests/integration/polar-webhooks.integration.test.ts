import { createId } from "@paralleldrive/cuid2";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { updatePlanFromWebhook } from "@/lib/auth-webhooks";
import prisma from "@/lib/db";

/**
 * Guarded like every other integration suite: without TEST_DATABASE_URL there
 * is no test database to talk to, and running anyway would mean creating and
 * deleting users and organizations in whatever DATABASE_URL points at.
 */
const hasDb = Boolean(process.env.TEST_DATABASE_URL);

/**
 * AF-M8-23 moved the product-id -> plan mapping out of the source and into
 * `POLAR_PRODUCT_ID_*`. This suite must therefore supply its own mapping: it
 * used to hardcode a product id that only resolved because that same id
 * happened to sit in the developer's `.env`, so it passed locally and failed
 * anywhere else. Stubbing here makes the plan map a fact of the test rather
 * than of the machine running it.
 */
const PRO_PRODUCT_ID = "287c0566-c317-491b-b804-c118a4fdab0f";

describe.runIf(hasDb)("Polar webhooks", () => {
  let userId: string;
  let orgId: string;

  beforeEach(async () => {
    // Clear the single-product fallback too, so an ambient POLAR_PRODUCT_ID
    // cannot map a second id to PRO behind the test's back.
    vi.stubEnv("POLAR_PRODUCT_ID", "");
    vi.stubEnv("POLAR_PRODUCT_ID_STARTER", "");
    vi.stubEnv("POLAR_PRODUCT_ID_ENTERPRISE", "");
    vi.stubEnv("POLAR_PRODUCT_ID_PRO", PRO_PRODUCT_ID);

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
    vi.unstubAllEnvs();
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("upgrades plan and logs audit event", async () => {
    await updatePlanFromWebhook(userId, PRO_PRODUCT_ID, false);

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
    await updatePlanFromWebhook(userId, PRO_PRODUCT_ID, false);

    const countBefore = await prisma.auditLog.count({
      where: { organizationId: orgId, action: "organization.update_plan" },
    });
    expect(countBefore).toBe(1);

    // Redelivery
    await updatePlanFromWebhook(userId, PRO_PRODUCT_ID, false);

    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    expect(org?.plan).toBe("PRO"); // Stays PRO

    const countAfter = await prisma.auditLog.count({
      where: { organizationId: orgId, action: "organization.update_plan" },
    });
    expect(countAfter).toBe(1); // No new audit log
  });

  it("downgrades to FREE on cancellation", async () => {
    // Setup to PRO
    await updatePlanFromWebhook(userId, PRO_PRODUCT_ID, false);
    let org = await prisma.organization.findUnique({ where: { id: orgId } });
    expect(org?.plan).toBe("PRO");

    // Cancel
    await updatePlanFromWebhook(userId, PRO_PRODUCT_ID, true);

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
