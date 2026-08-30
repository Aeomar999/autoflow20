import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { PAGINATION } from "@/config/constants";
import { logAuditEvent } from "@/lib/audit";
import prisma from "@/lib/db";
import type { Role } from "@/lib/rbac";
import {
  createTRPCRouter,
  orgAdminProcedure,
  orgOwnerProcedure,
  orgViewerProcedure,
  protectedProcedure,
} from "@/trpc/init";

const roleSchema = z.enum(["OWNER", "ADMIN", "EDITOR", "VIEWER"]);

export const organizationsRouter = createTRPCRouter({
  list: protectedProcedure.query(async ({ ctx }) => {
    const memberships = await prisma.member.findMany({
      where: { userId: ctx.auth.user.id },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            slug: true,
            plan: true,
            createdAt: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    return memberships.map((m) => ({
      id: m.organization.id,
      name: m.organization.name,
      slug: m.organization.slug,
      plan: m.organization.plan,
      role: m.role as Role,
      joinedAt: m.createdAt,
    }));
  }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(50),
        slug: z
          .string()
          .min(2)
          .max(50)
          .regex(
            /^[a-z0-9-]+$/,
            "Slug must be lowercase alphanumeric and dashes",
          ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await prisma.organization.findUnique({
        where: { slug: input.slug },
      });

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Organization slug "${input.slug}" is already taken`,
        });
      }

      const org = await prisma.organization.create({
        data: {
          name: input.name,
          slug: input.slug,
          plan: "FREE",
          members: {
            create: {
              userId: ctx.auth.user.id,
              role: "OWNER",
            },
          },
          workspaces: {
            create: {
              name: "Default",
              slug: "default",
            },
          },
        },
      });

      await logAuditEvent({
        organizationId: org.id,
        actorId: ctx.auth.user.id,
        action: "organization.create",
        resourceType: "organization",
        resourceId: org.id,
        after: { name: org.name, slug: org.slug },
      });

      return org;
    }),

  update: orgAdminProcedure
    .input(
      z.object({
        name: z.string().min(1).max(50).optional(),
        slug: z
          .string()
          .min(2)
          .max(50)
          .regex(/^[a-z0-9-]+$/)
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const before = await prisma.organization.findUnique({
        where: { id: ctx.org.id },
      });

      if (input.slug && input.slug !== ctx.org.slug) {
        const existing = await prisma.organization.findUnique({
          where: { slug: input.slug },
        });
        if (existing) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Slug "${input.slug}" is already in use`,
          });
        }
      }

      const updated = await prisma.organization.update({
        where: { id: ctx.org.id },
        data: {
          ...(input.name ? { name: input.name } : {}),
          ...(input.slug ? { slug: input.slug } : {}),
        },
      });

      await logAuditEvent({
        organizationId: ctx.org.id,
        actorId: ctx.auth.user.id,
        action: "organization.update",
        resourceType: "organization",
        resourceId: ctx.org.id,
        before: before ? { name: before.name, slug: before.slug } : null,
        after: { name: updated.name, slug: updated.slug },
      });

      return updated;
    }),

  delete: orgOwnerProcedure.mutation(async ({ ctx }) => {
    const org = await prisma.organization.delete({
      where: { id: ctx.org.id },
    });

    await logAuditEvent({
      organizationId: ctx.org.id,
      actorId: ctx.auth.user.id,
      action: "organization.delete",
      resourceType: "organization",
      resourceId: ctx.org.id,
      before: { name: org.name, slug: org.slug },
    });

    return { success: true };
  }),

  getMembers: orgViewerProcedure.query(async ({ ctx }) => {
    const members = await prisma.member.findMany({
      where: { organizationId: ctx.org.id },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    return members.map((m) => ({
      id: m.id,
      userId: m.userId,
      name: m.user.name,
      email: m.user.email,
      image: m.user.image,
      role: m.role as Role,
      createdAt: m.createdAt,
    }));
  }),

  inviteMember: orgAdminProcedure
    .input(
      z.object({
        email: z.string().email(),
        role: roleSchema.default("EDITOR"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existingMember = await prisma.member.findFirst({
        where: {
          organizationId: ctx.org.id,
          user: { email: input.email },
        },
      });

      if (existingMember) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "User is already a member of this organization",
        });
      }

      const existingInvite = await prisma.invitation.findFirst({
        where: {
          organizationId: ctx.org.id,
          email: input.email,
        },
      });

      if (existingInvite && existingInvite.expiresAt > new Date()) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "An active invitation already exists for this email",
        });
      }

      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      const invitation = await prisma.invitation.create({
        data: {
          organizationId: ctx.org.id,
          email: input.email.toLowerCase(),
          role: input.role,
          invitedById: ctx.auth.user.id,
          expiresAt,
        },
      });

      await logAuditEvent({
        organizationId: ctx.org.id,
        actorId: ctx.auth.user.id,
        action: "member.invite",
        resourceType: "invitation",
        resourceId: invitation.id,
        after: { email: input.email, role: input.role },
      });

      return invitation;
    }),

  updateMemberRole: orgAdminProcedure
    .input(
      z.object({
        memberId: z.string(),
        role: roleSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const member = await prisma.member.findFirst({
        where: { id: input.memberId, organizationId: ctx.org.id },
      });

      if (!member) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Member not found in organization",
        });
      }

      if (member.role === "OWNER" && input.role !== "OWNER") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Cannot change the primary Owner's role. Transfer ownership instead.",
        });
      }

      const updated = await prisma.member.update({
        where: { id: input.memberId },
        data: { role: input.role },
      });

      await logAuditEvent({
        organizationId: ctx.org.id,
        actorId: ctx.auth.user.id,
        action: "member.updateRole",
        resourceType: "member",
        resourceId: member.id,
        before: { role: member.role },
        after: { role: input.role },
      });

      return updated;
    }),

  removeMember: orgAdminProcedure
    .input(z.object({ memberId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const member = await prisma.member.findFirst({
        where: { id: input.memberId, organizationId: ctx.org.id },
      });

      if (!member) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Member not found in organization",
        });
      }

      if (member.role === "OWNER") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot remove the organization Owner",
        });
      }

      await prisma.member.delete({
        where: { id: input.memberId },
      });

      await logAuditEvent({
        organizationId: ctx.org.id,
        actorId: ctx.auth.user.id,
        action: "member.remove",
        resourceType: "member",
        resourceId: member.id,
        before: { userId: member.userId, role: member.role },
      });

      return { success: true };
    }),

  listInvitations: orgAdminProcedure.query(async ({ ctx }) => {
    return prisma.invitation.findMany({
      where: {
        organizationId: ctx.org.id,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });
  }),

  cancelInvitation: orgAdminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const invite = await prisma.invitation.findFirst({
        where: { id: input.id, organizationId: ctx.org.id },
      });

      if (!invite) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Invitation not found",
        });
      }

      await prisma.invitation.delete({
        where: { id: input.id },
      });

      await logAuditEvent({
        organizationId: ctx.org.id,
        actorId: ctx.auth.user.id,
        action: "invitation.cancel",
        resourceType: "invitation",
        resourceId: invite.id,
        before: { email: invite.email },
      });

      return { success: true };
    }),

  acceptInvite: protectedProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const invite = await prisma.invitation.findUnique({
        where: { token: input.token },
        include: { organization: true },
      });

      if (!invite || invite.expiresAt < new Date()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invitation is invalid or has expired",
        });
      }

      const existing = await prisma.member.findUnique({
        where: {
          organizationId_userId: {
            organizationId: invite.organizationId,
            userId: ctx.auth.user.id,
          },
        },
      });

      if (!existing) {
        await prisma.member.create({
          data: {
            organizationId: invite.organizationId,
            userId: ctx.auth.user.id,
            role: invite.role,
          },
        });
      }

      await prisma.invitation.delete({
        where: { id: invite.id },
      });

      await logAuditEvent({
        organizationId: invite.organizationId,
        actorId: ctx.auth.user.id,
        action: "invitation.accept",
        resourceType: "organization",
        resourceId: invite.organizationId,
        after: { userId: ctx.auth.user.id, role: invite.role },
      });

      return {
        organizationId: invite.organizationId,
        organizationName: invite.organization.name,
      };
    }),

  listAuditLogs: orgAdminProcedure
    .input(
      z.object({
        page: z.number().default(PAGINATION.DEFAULT_PAGE),
        pageSize: z
          .number()
          .min(PAGINATION.MIN_PAGE_SIZE)
          .max(PAGINATION.MAX_PAGE_SIZE)
          .default(PAGINATION.DEFAULT_PAGE_SIZE),
        action: z.string().optional(),
        resourceType: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { page, pageSize, action, resourceType } = input;

      const where = {
        organizationId: ctx.org.id,
        ...(action
          ? { action: { contains: action, mode: "insensitive" as const } }
          : {}),
        ...(resourceType ? { resourceType } : {}),
      };

      const [items, totalCount] = await Promise.all([
        prisma.auditLog.findMany({
          skip: (page - 1) * pageSize,
          take: pageSize,
          where,
          orderBy: { createdAt: "desc" },
          include: {
            actor: {
              select: { id: true, name: true, email: true },
            },
          },
        }),
        prisma.auditLog.count({ where }),
      ]);

      const totalPages = Math.ceil(totalCount / pageSize);

      return {
        items,
        page,
        pageSize,
        totalCount,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      };
    }),

  getWorkspaces: orgViewerProcedure.query(async ({ ctx }) => {
    return prisma.workspace.findMany({
      where: { organizationId: ctx.org.id },
      orderBy: { createdAt: "asc" },
    });
  }),
});
