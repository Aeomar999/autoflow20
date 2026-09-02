import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.fn();
const update = vi.fn();

vi.mock("@/lib/db", () => ({
  default: {
    member: {
      findMany: (...args: unknown[]) => findMany(...args),
    },
    organization: {
      update: (...args: unknown[]) => update(...args),
    },
  },
}));

const logAuditEvent = vi.fn();
vi.mock("@/lib/audit", () => ({
  logAuditEvent: (...args: unknown[]) => logAuditEvent(...args),
}));

const warn = vi.fn();
const error = vi.fn();
vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: (...args: unknown[]) => warn(...args),
    error: (...args: unknown[]) => error(...args),
  },
}));

import { resolvePlanMap, updatePlanFromWebhook } from "./auth-webhooks";

const STARTER_ID = "11111111-1111-4111-8111-111111111111";
const PRO_ID = "22222222-2222-4222-8222-222222222222";
const ENTERPRISE_ID = "33333333-3333-4333-8333-333333333333";

/** One OWNER membership, shaped as the query's `include` returns it. */
const membership = (organizationId: string, plan: string) => ({
  id: `member_${organizationId}`,
  organizationId,
  userId: "user_1",
  role: "OWNER",
  organization: { id: organizationId, plan },
});

beforeEach(() => {
  vi.clearAllMocks();
  findMany.mockResolvedValue([]);
});

describe("resolvePlanMap", () => {
  it("maps each configured product id to its plan", () => {
    expect(
      resolvePlanMap({
        POLAR_PRODUCT_ID_STARTER: STARTER_ID,
        POLAR_PRODUCT_ID_PRO: PRO_ID,
        POLAR_PRODUCT_ID_ENTERPRISE: ENTERPRISE_ID,
      }),
    ).toEqual({
      [STARTER_ID]: "STARTER",
      [PRO_ID]: "PRO",
      [ENTERPRISE_ID]: "ENTERPRISE",
    });
  });

  it("is empty when nothing is configured, so no product grants a plan", () => {
    expect(resolvePlanMap({})).toEqual({});
  });

  it("treats the checkout product as Pro for a single-product install", () => {
    expect(resolvePlanMap({ POLAR_PRODUCT_ID: PRO_ID })).toEqual({
      [PRO_ID]: "PRO",
    });
  });

  it("prefers an explicit Pro id over the checkout product", () => {
    expect(
      resolvePlanMap({
        POLAR_PRODUCT_ID: STARTER_ID,
        POLAR_PRODUCT_ID_PRO: PRO_ID,
      }),
    ).toEqual({ [PRO_ID]: "PRO" });
  });
});

describe("updatePlanFromWebhook", () => {
  beforeEach(() => {
    vi.stubEnv("POLAR_PRODUCT_ID", "");
    vi.stubEnv("POLAR_PRODUCT_ID_STARTER", STARTER_ID);
    vi.stubEnv("POLAR_PRODUCT_ID_PRO", PRO_ID);
    vi.stubEnv("POLAR_PRODUCT_ID_ENTERPRISE", ENTERPRISE_ID);
  });

  it("upgrades the owned organisation to the purchased plan", async () => {
    findMany.mockResolvedValue([membership("org_1", "FREE")]);

    await updatePlanFromWebhook("user_1", PRO_ID, false);

    expect(update).toHaveBeenCalledWith({
      where: { id: "org_1" },
      data: { plan: "PRO" },
    });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_1",
        action: "organization.update_plan",
        before: { plan: "FREE" },
        after: { plan: "PRO" },
      }),
    );
  });

  it("returns the organisation to FREE on cancellation, whatever the product", async () => {
    findMany.mockResolvedValue([membership("org_1", "PRO")]);

    await updatePlanFromWebhook("user_1", PRO_ID, true);

    expect(update).toHaveBeenCalledWith({
      where: { id: "org_1" },
      data: { plan: "FREE" },
    });
  });

  it("downgrades even when the cancelled product is not mapped", async () => {
    findMany.mockResolvedValue([membership("org_1", "PRO")]);

    await updatePlanFromWebhook(
      "user_1",
      "a-product-we-never-configured",
      true,
    );

    expect(update).toHaveBeenCalledWith({
      where: { id: "org_1" },
      data: { plan: "FREE" },
    });
  });

  it("never grants a plan for an unmapped product, and says so", async () => {
    findMany.mockResolvedValue([membership("org_1", "FREE")]);

    await updatePlanFromWebhook(
      "user_1",
      "a-product-we-never-configured",
      false,
    );

    expect(update).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
  });

  it("never grants a plan when no mapping is configured at all", async () => {
    vi.stubEnv("POLAR_PRODUCT_ID_STARTER", "");
    vi.stubEnv("POLAR_PRODUCT_ID_PRO", "");
    vi.stubEnv("POLAR_PRODUCT_ID_ENTERPRISE", "");

    await updatePlanFromWebhook("user_1", PRO_ID, false);

    expect(update).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
  });

  it("is a no-op when the organisation is already on the target plan", async () => {
    // Polar re-delivers; a replay must not write a second audit entry.
    findMany.mockResolvedValue([membership("org_1", "PRO")]);

    await updatePlanFromWebhook("user_1", PRO_ID, false);

    expect(update).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("ignores a webhook with no customer external id", async () => {
    await updatePlanFromWebhook(null, PRO_ID, false);

    expect(findMany).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it("only ever considers OWNER memberships", async () => {
    findMany.mockResolvedValue([membership("org_1", "FREE")]);

    await updatePlanFromWebhook("user_1", PRO_ID, false);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user_1", role: "OWNER" },
      }),
    );
  });

  it("warns when one subscription fans out across several workspaces", async () => {
    // A Polar customer is a user, and the checkout carries no organisation, so
    // one subscription upgrades every workspace they own. Visible, not silent.
    findMany.mockResolvedValue([
      membership("org_1", "FREE"),
      membership("org_2", "FREE"),
    ]);

    await updatePlanFromWebhook("user_1", PRO_ID, false);

    expect(update).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalled();
  });

  it("warns when the customer owns nothing to upgrade", async () => {
    findMany.mockResolvedValue([]);

    await updatePlanFromWebhook("user_1", PRO_ID, false);

    expect(update).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });
});
