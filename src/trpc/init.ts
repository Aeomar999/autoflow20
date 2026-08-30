import { initTRPC, TRPCError } from "@trpc/server";
import { headers } from "next/headers";
import { cache } from "react";
import superjson from "superjson";
import { auth } from "@/lib/auth";
import prisma from "@/lib/db";
import { polarClient } from "@/lib/polar";
import { isRoleAtLeast, type Role } from "@/lib/rbac";

export interface ActiveOrgContext {
  id: string;
  name: string;
  slug: string;
  role: Role;
}

export const createTRPCContext = cache(async () => {
  return {};
});

const t = initTRPC.create({
  transformer: superjson,
});

export const createTRPCRouter = t.router;
export const createCallerFactory = t.createCallerFactory;

export const baseProcedure = t.procedure;

export const protectedProcedure = baseProcedure.use(async ({ ctx, next }) => {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Unauthorized",
    });
  }

  return next({ ctx: { ...ctx, auth: session } });
});

export const premiumProcedure = protectedProcedure.use(
  async ({ ctx, next }) => {
    // Bypass premium check for E2E tests to allow workflow creation
    if (process.env.E2E_SERVER === "1") {
      return next({ ctx: { ...ctx, customer: null } });
    }

    const customer = await polarClient.customers.getStateExternal({
      externalId: ctx.auth.user.id,
    });

    if (
      !customer.activeSubscriptions ||
      customer.activeSubscriptions.length === 0
    ) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Active subscription required",
      });
    }

    return next({ ctx: { ...ctx, customer } });
  },
);

async function resolveActiveOrg(
  userId: string,
  userEmail: string,
  userName?: string,
): Promise<ActiveOrgContext> {
  const reqHeaders = await headers();
  const orgHeader = reqHeaders.get("x-organization-id");
  const cookieHeader = reqHeaders.get("cookie") || "";
  const cookieOrg = cookieHeader
    .split("; ")
    .find((row) => row.startsWith("autoflow_active_org="))
    ?.split("=")[1];

  const targetOrgId = orgHeader || cookieOrg;

  if (targetOrgId) {
    const membership = await prisma.member.findUnique({
      where: {
        organizationId_userId: {
          organizationId: targetOrgId,
          userId,
        },
      },
      include: {
        organization: {
          select: { id: true, name: true, slug: true },
        },
      },
    });

    if (membership?.organization) {
      return {
        id: membership.organization.id,
        name: membership.organization.name,
        slug: membership.organization.slug,
        role: membership.role as Role,
      };
    }
  }

  const memberships = await prisma.member.findMany({
    where: { userId },
    include: {
      organization: {
        select: { id: true, name: true, slug: true },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const ownerMembership =
    memberships.find((m) => m.role === "OWNER") || memberships[0];

  if (ownerMembership?.organization) {
    return {
      id: ownerMembership.organization.id,
      name: ownerMembership.organization.name,
      slug: ownerMembership.organization.slug,
      role: ownerMembership.role as Role,
    };
  }

  const baseName = userName || userEmail.split("@")[0] || "Personal";
  const slug = `${baseName.toLowerCase().replace(/[^a-z0-9]/g, "-")}-${userId.slice(0, 6)}`;

  const org = await prisma.organization.create({
    data: {
      name: `${baseName}'s Workspace`,
      slug,
      plan: "FREE",
      members: {
        create: {
          userId,
          role: "OWNER",
        },
      },
      workspaces: {
        create: {
          name: "Default Workspace",
          slug: "default",
        },
      },
    },
    select: { id: true, name: true, slug: true },
  });

  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    role: "OWNER",
  };
}

export function orgProcedure(minRole: Role = "VIEWER") {
  return protectedProcedure.use(async ({ ctx, next }) => {
    const org = await resolveActiveOrg(
      ctx.auth.user.id,
      ctx.auth.user.email,
      ctx.auth.user.name,
    );

    if (!isRoleAtLeast(org.role, minRole)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Insufficient permissions: requires at least ${minRole} role`,
      });
    }

    return next({ ctx: { ...ctx, org } });
  });
}

export const orgViewerProcedure = orgProcedure("VIEWER");
export const orgEditorProcedure = orgProcedure("EDITOR");
export const orgAdminProcedure = orgProcedure("ADMIN");
export const orgOwnerProcedure = orgProcedure("OWNER");
