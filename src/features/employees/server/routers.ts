/**
 * Employees router — org-scoped lifecycle record for the Employee Lifecycle
 * mega-workflow (W1 acquisition → W2 onboarding → W3 tenure → W4 offboarding).
 *
 * `applyHandoff` is the phase-to-phase contract endpoint consumed by the
 * phase workflows' `WEBHOOK_TRIGGER` nodes; it returns a structured outcome
 * the graph can branch on (created / transitioned / already-current /
 * conflict) instead of throwing. Everything else here is the manual HR
 * surface: list, read, create, patch.
 *
 * Every query filters by `ctx.org.id` in the `where` clause — never post-fetch.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { PAGINATION } from "@/config/constants";
import {
  dateOnlySchema,
  EMPLOYEE_STATUSES,
  employeeHandoffSchema,
  employeeRefSchema,
} from "@/features/employees/lib/employee";
import type { Prisma } from "@/generated/prisma/client";
import prisma from "@/lib/db";
import {
  createTRPCRouter,
  orgEditorProcedure,
  orgViewerProcedure,
} from "@/trpc/init";

import { applyEmployeeHandoff } from "./handoff";

const employeeStatusSchema = z.enum(EMPLOYEE_STATUSES);

const createInputSchema = z.object({
  employeeRef: employeeRefSchema,
  email: z.string().email(),
  fullName: z.string().trim().min(1).max(300),
  role: z.string().trim().min(1).max(200),
  department: z.string().trim().max(200).optional(),
  managerEmail: z.string().email().optional(),
  personalEmail: z.string().email().optional(),
  startDate: dateOnlySchema.optional(),
});

const patchInputSchema = z.object({
  email: z.string().email().optional(),
  fullName: z.string().trim().min(1).max(300).optional(),
  role: z.string().trim().min(1).max(200).optional(),
  department: z.string().trim().max(200).nullish(),
  managerEmail: z.string().email().nullish(),
  personalEmail: z.string().email().nullish(),
  startDate: dateOnlySchema.nullish(),
});

const listInputSchema = z.object({
  status: employeeStatusSchema.optional(),
  page: z.number().int().min(1).default(PAGINATION.DEFAULT_PAGE),
  pageSize: z
    .number()
    .int()
    .min(PAGINATION.MIN_PAGE_SIZE)
    .max(PAGINATION.MAX_PAGE_SIZE)
    .default(PAGINATION.DEFAULT_PAGE_SIZE),
});

const employeeSelect = {
  id: true,
  employeeRef: true,
  email: true,
  fullName: true,
  role: true,
  department: true,
  managerEmail: true,
  personalEmail: true,
  startDate: true,
  status: true,
  source: true,
  offerSignedAt: true,
  activeAt: true,
  exitDate: true,
  exitReason: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.EmployeeSelect;

function assertFound<T>(value: T | null): T {
  if (value === null) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Employee not found." });
  }
  return value;
}

export const employeesRouter = createTRPCRouter({
  list: orgViewerProcedure
    .input(listInputSchema)
    .query(async ({ ctx, input }) => {
      const { status, page, pageSize } = input;

      const where: Prisma.EmployeeWhereInput = {
        organizationId: ctx.org.id,
        ...(status ? { status } : {}),
      };

      const [items, totalCount] = await Promise.all([
        prisma.employee.findMany({
          where,
          orderBy: { createdAt: "desc" as const },
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: employeeSelect,
        }),
        prisma.employee.count({ where }),
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

  getById: orgViewerProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      return assertFound(
        await prisma.employee.findFirst({
          where: { id: input.id, organizationId: ctx.org.id },
          select: employeeSelect,
        }),
      );
    }),

  create: orgEditorProcedure
    .input(createInputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const employee = await prisma.employee.create({
          data: {
            organizationId: ctx.org.id,
            employeeRef: input.employeeRef,
            email: input.email,
            fullName: input.fullName,
            role: input.role,
            department: input.department ?? null,
            managerEmail: input.managerEmail ?? null,
            personalEmail: input.personalEmail ?? null,
            startDate: input.startDate
              ? new Date(`${input.startDate}T00:00:00`)
              : undefined,
            status: "CANDIDATE",
            source: "MANUAL",
          },
          select: employeeSelect,
        });
        return employee;
      } catch (err) {
        if (
          typeof err === "object" &&
          err !== null &&
          "code" in err &&
          (err as { code?: string }).code === "P2002"
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "An employee with this employeeRef or email already exists.",
          });
        }
        throw err;
      }
    }),

  patch: orgEditorProcedure
    .input(z.object({ id: z.string().min(1), ...patchInputSchema.shape }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      return assertFound(
        await prisma.employee
          .updateManyAndReturn({
            where: { id, organizationId: ctx.org.id },
            data: {
              ...(data.email !== undefined ? { email: data.email } : {}),
              ...(data.fullName !== undefined
                ? { fullName: data.fullName }
                : {}),
              ...(data.role !== undefined ? { role: data.role } : {}),
              ...(data.department !== undefined
                ? { department: data.department }
                : {}),
              ...(data.managerEmail !== undefined
                ? { managerEmail: data.managerEmail }
                : {}),
              ...(data.personalEmail !== undefined
                ? { personalEmail: data.personalEmail }
                : {}),
              ...(data.startDate !== undefined
                ? {
                    startDate: data.startDate
                      ? new Date(`${data.startDate}T00:00:00`)
                      : null,
                  }
                : {}),
            },
            select: employeeSelect,
          })
          .then((rows) => rows[0] ?? null),
      );
    }),

  applyHandoff: orgEditorProcedure
    .input(employeeHandoffSchema)
    .mutation(async ({ ctx, input }) => {
      return applyEmployeeHandoff(ctx.org.id, input);
    }),
});
