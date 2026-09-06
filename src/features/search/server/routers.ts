import { z } from "zod";

import { ExecutionStatus } from "@/generated/prisma/client";
import prisma from "@/lib/db";
import { createTRPCRouter, orgViewerProcedure } from "@/trpc/init";

import type { SearchResult, SearchResults } from "../lib/types";

/**
 * Command palette search (AF-M7-07).
 *
 * Design decision (locked 2026-08-30): a dedicated tenant-scoped server router,
 * not a client-side preloaded index. An index shipped to the browser would mean
 * every workflow, execution, and credential name in the workspace sitting in
 * memory on every page, and would go stale the moment anything changed.
 *
 * Every query is scoped through `ctx.org.id` in the `where` clause and capped
 * by `take`. Three scoped `findMany`s in one `Promise.all` rather than a
 * hand-written SQL UNION: the union is over three different tables with three
 * different shapes, so the SQL would have to erase Prisma's types to line the
 * columns up — and the tenancy guarantee, which is the part that matters, is
 * identical either way.
 *
 * Navigation entries and actions are static and carry no tenant data, so they
 * live on the client (`lib/static-commands.ts`) and never make this round trip.
 */

const searchInput = z.object({
  q: z.string().max(200).default(""),
  /** Per result kind, not overall. */
  limit: z.number().int().min(1).max(20).default(5),
});

/** `q` matched against the ExecutionStatus enum, so "fail" finds FAILED runs. */
function matchingStatuses(q: string): ExecutionStatus[] {
  const needle = q.trim().toUpperCase();
  if (needle.length === 0) return [];
  return Object.values(ExecutionStatus).filter((status) =>
    status.includes(needle),
  );
}

export const searchRouter = createTRPCRouter({
  query: orgViewerProcedure
    .input(searchInput)
    .query(async ({ ctx, input }): Promise<SearchResults> => {
      const organizationId = ctx.org.id;
      const q = input.q.trim();
      const take = input.limit;

      const statuses = matchingStatuses(q);

      const [workflows, executions, credentials, employees] = await Promise.all(
        [
          prisma.workflow.findMany({
            where: {
              organizationId,
              ...(q ? { name: { contains: q, mode: "insensitive" } } : {}),
            },
            orderBy: { updatedAt: "desc" },
            take,
            select: { id: true, name: true, updatedAt: true },
          }),
          prisma.execution.findMany({
            where: {
              // Execution carries no organizationId of its own; it reaches the
              // tenant through its workflow (data_model.md §2.4).
              workflow: { organizationId },
              ...(q
                ? {
                    OR: [
                      { id: { startsWith: q } },
                      ...(statuses.length > 0
                        ? [{ status: { in: statuses } }]
                        : []),
                      {
                        workflow: {
                          name: { contains: q, mode: "insensitive" as const },
                        },
                      },
                    ],
                  }
                : {}),
            },
            orderBy: { startedAt: "desc" },
            take,
            select: {
              id: true,
              status: true,
              startedAt: true,
              workflow: { select: { name: true } },
            },
          }),
          prisma.credential.findMany({
            where: {
              organizationId,
              ...(q ? { name: { contains: q, mode: "insensitive" } } : {}),
            },
            orderBy: { updatedAt: "desc" },
            take,
            select: { id: true, name: true, type: true },
          }),
          /**
           * AF-M11-09. People are found by the three things a user actually has
           * in front of them: the name, the `employeeRef` off a workflow run,
           * and the work email. The whole OR sits INSIDE the tenant-scoped
           * `where` — never a fetch-then-filter, which would leak the existence
           * of another tenant's people through result counts and timings.
           */
          prisma.employee.findMany({
            where: {
              organizationId,
              ...(q
                ? {
                    OR: [
                      {
                        fullName: { contains: q, mode: "insensitive" as const },
                      },
                      {
                        employeeRef: {
                          contains: q,
                          mode: "insensitive" as const,
                        },
                      },
                      { email: { contains: q, mode: "insensitive" as const } },
                    ],
                  }
                : {}),
            },
            orderBy: { updatedAt: "desc" },
            take,
            select: {
              id: true,
              fullName: true,
              employeeRef: true,
              status: true,
            },
          }),
        ],
      );

      return {
        workflows: workflows.map(
          (workflow): SearchResult => ({
            kind: "workflow",
            id: workflow.id,
            title: workflow.name,
            subtitle: "Workflow",
            href: `/workflows/${workflow.id}`,
          }),
        ),
        executions: executions.map(
          (execution): SearchResult => ({
            kind: "execution",
            id: execution.id,
            title: execution.workflow.name,
            // The short id is what a user has in front of them from a log line
            // or a URL, and it is what they will type.
            subtitle: `${execution.status} · ${execution.id.slice(0, 8)}`,
            href: `/executions/${execution.id}`,
          }),
        ),
        credentials: credentials.map(
          (credential): SearchResult => ({
            kind: "credential",
            id: credential.id,
            title: credential.name,
            // Type only. A credential's secret has no read path, and its
            // preview has no business in a global search result.
            subtitle: credential.type,
            href: `/credentials/${credential.id}`,
          }),
        ),
        employees: employees.map(
          (employee): SearchResult => ({
            kind: "employee",
            id: employee.id,
            title: employee.fullName,
            // Status plus the business key — enough to tell two people with
            // the same name apart. Contact details stay off the palette.
            subtitle: `${employee.status} · ${employee.employeeRef}`,
            href: `/employees/${employee.id}`,
          }),
        ),
      };
    }),
});
