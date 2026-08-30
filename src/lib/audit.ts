import type { Prisma } from "@/generated/prisma/client";
import prisma from "@/lib/db";

export interface AuditEventParams {
  organizationId: string;
  actorId?: string | null;
  actorType?: "USER" | "API_KEY" | "SYSTEM";
  action: string;
  resourceType: string;
  resourceId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  ip?: string | null;
  userAgent?: string | null;
}

export async function logAuditEvent(params: AuditEventParams): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        organizationId: params.organizationId,
        actorId: params.actorId ?? null,
        actorType: params.actorType ?? "USER",
        action: params.action,
        resourceType: params.resourceType,
        resourceId: params.resourceId,
        before:
          (params.before as unknown as Prisma.InputJsonValue) ?? undefined,
        after: (params.after as unknown as Prisma.InputJsonValue) ?? undefined,
        ip: params.ip ?? null,
        userAgent: params.userAgent ?? null,
      },
    });
  } catch (error) {
    console.error("[audit] Failed to write audit log entry:", error);
  }
}
