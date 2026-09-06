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

/**
 * The shape `applyEmployeeHandoff` writes into `AuditLog.after`. Parsed rather
 * than cast: `after` is an untyped `Json` column, so anything reading it is
 * reading external input (rule §7 in `engineering_rules.md`).
 */
const auditDetailSchema = z.object({
  from: employeeStatusSchema.optional(),
  to: employeeStatusSchema.optional(),
  status: employeeStatusSchema.optional(),
});

/**
 * A lifecycle is a handful of transitions, not a feed. Capped so one pathological
 * record (a workflow looping a handoff) cannot return an unbounded page.
 */
const TIMELINE_LIMIT = 200;

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

  /**
   * AF-M11-09. How many people sit at each phase of the chain, for the list
   * header and for whatever dashboards come later.
   *
   * One `groupBy` rather than six `count`s, and every status in the contract
   * appears in the result even at zero — a phase missing from the summary
   * would read as "not applicable" rather than "nobody here yet". Statuses
   * outside the contract (the column is an open-set String) are carried
   * through as themselves in `other`, never folded into a known bucket.
   */
  countByStatus: orgViewerProcedure.query(async ({ ctx }) => {
    const rows = await prisma.employee.groupBy({
      by: ["status"],
      where: { organizationId: ctx.org.id },
      _count: { _all: true },
    });

    const counts = new Map(rows.map((row) => [row.status, row._count._all]));

    return {
      total: rows.reduce((sum, row) => sum + row._count._all, 0),
      byStatus: EMPLOYEE_STATUSES.map((status) => ({
        status,
        count: counts.get(status) ?? 0,
      })),
      other: rows
        .filter((row) => !employeeStatusSchema.safeParse(row.status).success)
        .map((row) => ({ status: row.status, count: row._count._all })),
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

  /**
   * AF-M11-08. The status-chain timeline for one employee.
   *
   * There is no separate handoff-event table: `applyEmployeeHandoff` audits
   * every mutation (`employee.created` / `employee.status_changed`) with the
   * transition in `after`, so the audit log *is* the phase history. Reading it
   * here rather than adding a second write path keeps one source of truth —
   * and means a transition that skipped the audit would be visibly missing
   * from the timeline rather than quietly reconstructed from `status`.
   *
   * Ordered oldest-first: the chain reads forward, the way it happened.
   */
  timeline: orgViewerProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      // Confirms the row is this tenant's before any audit read. A foreign id
      // is NOT_FOUND, never an empty timeline that looks like "no history".
      assertFound(
        await prisma.employee.findFirst({
          where: { id: input.id, organizationId: ctx.org.id },
          select: { id: true },
        }),
      );

      const entries = await prisma.auditLog.findMany({
        where: {
          organizationId: ctx.org.id,
          resourceType: "employee",
          resourceId: input.id,
        },
        orderBy: { createdAt: "asc" },
        take: TIMELINE_LIMIT,
        select: {
          id: true,
          action: true,
          actorType: true,
          createdAt: true,
          after: true,
        },
      });

      return entries.map((entry) => {
        const detail = auditDetailSchema.safeParse(entry.after);
        return {
          id: entry.id,
          action: entry.action,
          actorType: entry.actorType,
          createdAt: entry.createdAt,
          // A row whose payload does not parse still appears, with its
          // transition unknown — dropping it would hide a real event.
          from: detail.success ? (detail.data.from ?? null) : null,
          to: detail.success
            ? (detail.data.to ?? detail.data.status ?? null)
            : null,
        };
      });
    }),

  applyHandoff: orgEditorProcedure
    .input(employeeHandoffSchema)
    .mutation(async ({ ctx, input }) => {
      return applyEmployeeHandoff(ctx.org.id, input);
    }),
});
