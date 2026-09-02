import type { Plan } from "@/generated/prisma/client";
import { logAuditEvent } from "@/lib/audit";
import prisma from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * Polar subscription webhooks -> `Organization.plan` (AF-M8-23).
 *
 * `Organization.plan` used to be written exactly once, at creation, and never
 * again — so a customer could complete checkout, be charged, and stay on FREE
 * limits forever. Quota, rate-limit buckets, and retention all read that
 * column, so this is the single place a paid subscription reaches the running
 * system.
 */

/**
 * Polar product id -> plan.
 *
 * Product ids are account-specific, so they come from the environment for the
 * same reason `POLAR_PRODUCT_ID` does (AF-M0-03): a UUID hard-coded here is
 * one account's sandbox id, and it silently maps nothing on every other
 * install. Resolved per call rather than at import so a deployment can rotate
 * the mapping without a rebuild.
 *
 * A single-product install configures only `POLAR_PRODUCT_ID` — the product
 * the checkout actually lists — so that id is treated as the Pro product and
 * its webhook works without a second variable. An explicit
 * `POLAR_PRODUCT_ID_PRO` always wins.
 */
export function resolvePlanMap(
  env: Record<string, string | undefined> = process.env,
): Record<string, Plan> {
  const candidates: Array<[string | undefined, Plan]> = [
    [env.POLAR_PRODUCT_ID_STARTER, "STARTER"],
    [env.POLAR_PRODUCT_ID_PRO ?? env.POLAR_PRODUCT_ID, "PRO"],
    [env.POLAR_PRODUCT_ID_ENTERPRISE, "ENTERPRISE"],
  ];

  const map: Record<string, Plan> = {};
  for (const [productId, plan] of candidates) {
    if (productId) {
      map[productId] = plan;
    }
  }
  return map;
}

/**
 * Apply a subscription event to every organisation the customer owns.
 *
 * `isDowngrade` covers cancellation and revocation, which carry the product
 * that was cancelled rather than a product to grant — so the target is FREE
 * regardless of the mapping.
 *
 * Idempotent by outcome rather than by event id: an organisation already on
 * the target plan is skipped, so Polar's re-deliveries are free. Nothing here
 * throws — a webhook that 500s is retried forever, and a plan we could not
 * apply is an operator problem, so every refusal is logged instead.
 */
export const updatePlanFromWebhook = async (
  customerId: string | null | undefined,
  productId: string | null,
  isDowngrade: boolean,
) => {
  if (!customerId) {
    // `createCustomerOnSignUp` sets externalId to the user id; its absence
    // means a customer created outside this app, which we cannot resolve.
    logger.warn(
      "Polar webhook carried no customer external id; plan unchanged",
      {
        productId,
        isDowngrade,
      },
    );
    return;
  }

  let targetPlan: Plan;
  if (isDowngrade) {
    targetPlan = "FREE";
  } else {
    const mapped = productId ? resolvePlanMap()[productId] : undefined;
    if (!mapped) {
      // Never grant a plan for a product we cannot identify. Loud, because the
      // cause is always configuration — a product added in Polar and not in
      // the environment — and the symptom is a paying customer on FREE.
      logger.error(
        "Polar webhook names a product with no plan mapping; plan unchanged",
        { productId, customerId },
      );
      return;
    }
    targetPlan = mapped;
  }

  const memberships = await prisma.member.findMany({
    where: { userId: customerId, role: "OWNER" },
    include: { organization: true },
  });

  if (memberships.length === 0) {
    logger.warn("Polar webhook customer owns no organisation; plan unchanged", {
      customerId,
      targetPlan,
    });
    return;
  }

  // A Polar customer is a USER, and a user can own several workspaces, so one
  // subscription upgrades all of them. That is a revenue leak on the upgrade
  // path and over-broad on the downgrade path, but the checkout carries no
  // organisation to scope it to — nothing links a subscription to a workspace.
  // Logged rather than quietly accepted; see docs/operations/operator_actions.md.
  if (memberships.length > 1) {
    logger.warn(
      "Polar subscription applied to every organisation the customer owns",
      {
        customerId,
        organizationCount: memberships.length,
        targetPlan,
      },
    );
  }

  for (const member of memberships) {
    if (member.organization.plan === targetPlan) continue;

    await prisma.organization.update({
      where: { id: member.organizationId },
      data: { plan: targetPlan },
    });

    await logAuditEvent({
      organizationId: member.organizationId,
      actorId: customerId,
      actorType: "SYSTEM",
      action: "organization.update_plan",
      resourceType: "organization",
      resourceId: member.organizationId,
      before: { plan: member.organization.plan },
      after: { plan: targetPlan },
    });
  }
};
