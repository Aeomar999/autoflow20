import { logAuditEvent } from "@/lib/audit";
import prisma from "@/lib/db";
import type { Plan } from "@/generated/prisma/client";

const PLAN_MAP: Record<string, Plan> = {
  "92c60556-b654-4c4f-acb6-34119166eca4": "STARTER",
  "287c0566-c317-491b-b804-c118a4fdab0f": "PRO",
  "5359afc7-6900-4368-83ea-c4c875fd62e5": "ENTERPRISE",
};

export const updatePlanFromWebhook = async (
  customerId: string | null | undefined,
  productId: string | null,
  isDowngrade: boolean,
) => {
  if (!customerId) return;
  const targetPlan: Plan = isDowngrade
    ? "FREE"
    : productId && PLAN_MAP[productId]
      ? PLAN_MAP[productId]
      : "FREE";

  // Unknown product id - do not silently grant a plan
  if (!isDowngrade && targetPlan === "FREE") return;

  const members = await prisma.member.findMany({
    where: { userId: customerId, role: "OWNER" },
    include: { organization: true },
  });

  for (const member of members) {
    if (member.organization.plan === targetPlan) continue;

    await prisma.organization.update({
      where: { id: member.organizationId },
      data: { plan: targetPlan },
    });

    await logAuditEvent({
      organizationId: member.organizationId,
      actorId: customerId,
      action: "organization.update_plan",
      resourceType: "organization",
      resourceId: member.organizationId,
      before: { plan: member.organization.plan },
      after: { plan: targetPlan },
    });
  }
};
