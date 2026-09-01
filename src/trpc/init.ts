import { initTRPC, TRPCError } from "@trpc/server";
import { headers } from "next/headers";
import { cache } from "react";
import superjson from "superjson";
import { auth } from "@/lib/auth";
import prisma from "@/lib/db";
import { polarClient } from "@/lib/polar";
import { type BucketConfig, memoryRateLimiter } from "@/lib/rate-limit";
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

/** Per-user mutation burst cap (security.md §8). Queries are not limited. */
const MUTATION_BURST: BucketConfig = { capacity: 60, refillPerSecond: 1 };

export const protectedProcedure = baseProcedure.use(
  async ({ ctx, type, next }) => {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Unauthorized",
      });
    }

    if (type === "mutation") {
      const decision = memoryRateLimiter.consume(
        `trpc:mutation:${session.user.id}`,
        MUTATION_BURST,
      );
      if (!decision.allowed) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Too many requests",
          cause: { retryAfterSeconds: decision.retryAfterSeconds },
        });
      }
    }

    return next({ ctx: { ...ctx, auth: session } });
  },
);

/** Active Polar customer for a userId, or null when E2E bypass is set. */
export async function resolvePremiumCustomer(
  userId: string,
): Promise<Awaited<
  ReturnType<typeof polarClient.customers.getStateExternal>
> | null> {
  // Bypass premium check for E2E tests to allow workflow creation
  if (process.env.E2E_SERVER === "1") {
    return null;
  }

  const customer = await polarClient.customers.getStateExternal({
    externalId: userId,
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

  return customer;
}

export const premiumProcedure = protectedProcedure.use(
  async ({ ctx, next }) => {
    const customer = await resolvePremiumCustomer(ctx.auth.user.id);
    return next({ ctx: { ...ctx, customer } });
  },
);

export async function resolveActiveOrg(
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

/** Org-scoped premium gate: resolves the org, checks the role, then the subscription. */
export const premiumOrgProcedure = orgEditorProcedure.use(
  async ({ ctx, next }) => {
    const customer = await resolvePremiumCustomer(ctx.auth.user.id);
    return next({ ctx: { ...ctx, customer } });
  },
);
