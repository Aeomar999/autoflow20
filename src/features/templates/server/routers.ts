import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { PAGINATION } from "@/config/constants";
import { validate } from "@/engine/validate";
import type { Prisma } from "@/generated/prisma/client";
import prisma from "@/lib/db";
import { nodeRegistry } from "@/nodes/registry";
import {
  createTRPCRouter,
  orgEditorProcedure,
  orgViewerProcedure,
} from "@/trpc/init";

import {
  collectPendingCredentials,
  collectPendingSetup,
  type PreparedTemplate,
  prepareTemplateGraph,
  type TemplateGraph,
} from "./instantiate";

const templateSlugSchema = z.string().min(1).max(200);

const templatesListSortSchema = z.enum([
  "mostInstalled",
  "recent",
  "fewestCredentials",
]);

const listInputSchema = z.object({
  category: z.string().default("All"),
  search: z.string().default(""),
  sort: templatesListSortSchema.default("mostInstalled"),
  page: z.number().int().min(1).default(PAGINATION.DEFAULT_PAGE),
  pageSize: z
    .number()
    .int()
    .min(PAGINATION.MIN_PAGE_SIZE)
    .max(PAGINATION.MAX_PAGE_SIZE)
    .default(PAGINATION.DEFAULT_PAGE_SIZE),
});

/**
 * Templates router — see `docs/architecture/api_contract.md` §3.
 *
 * Templates are tenant-agnostic product content: `list`/`getOne` need only an
 * authenticated viewer, `instantiate` needs editor rights on the target
 * workspace. Instantiation copies the template's graph into a brand-new
 * workspace workflow with fresh node ids and stripped credential bindings.
 */
export const templatesRouter = createTRPCRouter({
  list: orgViewerProcedure.input(listInputSchema).query(async ({ input }) => {
    const { category, search, sort, page, pageSize } = input;

    const baseWhere: Prisma.TemplateWhereInput = {
      isActive: true,
      ...(category && category !== "All" ? { category } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { description: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const orderBy: Prisma.TemplateOrderByWithRelationInput = (() => {
      switch (sort) {
        case "recent":
          return { createdAt: "desc" as const };
        case "fewestCredentials":
          return { credentialCount: "asc" as const };
        default:
          return { installs: "desc" as const };
      }
    })();

    const [items, totalCount] = await Promise.all([
      prisma.template.findMany({
        where: baseWhere,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          slug: true,
          name: true,
          description: true,
          category: true,
          tags: true,
          featured: true,
          nodeCount: true,
          credentialCount: true,
          author: true,
          version: true,
          installs: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.template.count({ where: baseWhere }),
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

  getOne: orgViewerProcedure
    .input(z.object({ slug: templateSlugSchema }))
    .query(async ({ input }) => {
      const template = await prisma.template.findUniqueOrThrow({
        where: { slug: input.slug },
        select: {
          id: true,
          slug: true,
          name: true,
          description: true,
          category: true,
          tags: true,
          featured: true,
          nodeCount: true,
          credentialCount: true,
          author: true,
          version: true,
          installs: true,
          createdAt: true,
          updatedAt: true,
          graph: true,
        },
      });

      const rawGraph = template.graph as unknown as TemplateGraph;
      const nodeSummary = rawGraph.nodes.map((n) => ({
        nodeId: n.id,
        nodeName: n.name ?? n.type,
        nodeType: n.type,
      }));

      return {
        id: template.id,
        slug: template.slug,
        name: template.name,
        description: template.description,
        category: template.category,
        tags: template.tags,
        featured: template.featured,
        nodeCount: template.nodeCount,
        credentialCount: template.credentialCount,
        author: template.author,
        version: template.version,
        installs: template.installs,
        createdAt: template.createdAt,
        updatedAt: template.updatedAt,
        nodeSummary,
        pendingCredentials: collectPendingCredentials(rawGraph.nodes),
        pendingSetup: collectPendingSetup(rawGraph.nodes),
      };
    }),

  instantiate: orgEditorProcedure
    .input(z.object({ slug: templateSlugSchema }))
    .mutation(async ({ ctx, input }) => {
      const template = await prisma.template.findUniqueOrThrow({
        where: { slug: input.slug },
        select: { id: true, name: true, graph: true },
      });

      const rawGraph = template.graph as unknown as TemplateGraph;

      // An authored template referencing an unknown node type is a data bug,
      // so surface it as a clean BAD_REQUEST, not a 500.
      if (
        !Array.isArray(rawGraph.nodes) ||
        !rawGraph.nodes.every(
          (n) => n && typeof n.type === "string" && nodeRegistry.has(n.type),
        )
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Template references an unknown node type.",
        });
      }

      let prepared: PreparedTemplate;
      try {
        prepared = prepareTemplateGraph(rawGraph);
      } catch (err) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Could not prepare template graph: ${err instanceof Error ? err.message : "unknown error"}`,
        });
      }

      // Same boundary the save route enforces: cycles, exactly one trigger,
      // required inputs wired, per-node config schema. Credential-bound fields
      // were stripped above (they are optional in every config schema), so
      // only genuinely broken configs surface here as errors.
      const { errors } = validate(
        {
          nodes: prepared.nodes.map((n) => ({
            id: n.id,
            name: n.name ?? n.type,
            type: n.type,
            data: n.data ?? {},
          })),
          connections: prepared.edges.map((e) => ({
            fromNodeId: e.source,
            toNodeId: e.target,
            fromOutput: e.sourceHandle ?? "main",
            toInput: e.targetHandle ?? "main",
          })),
        },
        nodeRegistry,
      );

      const critical = errors.filter((e) => e.severity === "error");
      if (critical.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Template graph validation failed: ${critical.map((e) => e.message).join("; ")}`,
        });
      }

      const workflow = await prisma.$transaction(async (tx) => {
        const created = await tx.workflow.create({
          data: {
            name: template.name,
            userId: ctx.auth.user.id,
            organizationId: ctx.org.id,
          },
        });

        if (prepared.nodes.length > 0) {
          await tx.node.createMany({
            data: prepared.nodes.map((n) => ({
              id: n.id,
              workflowId: created.id,
              name: n.name ?? n.type,
              type: n.type,
              position: n.position,
              data: (n.data ?? {}) as Prisma.InputJsonValue,
              notes: n.notes ?? null,
              disabled: n.disabled ?? false,
            })),
          });
        }

        const nodeIds = new Set(prepared.nodes.map((n) => n.id));
        const wiredEdges = prepared.edges.filter(
          (e) =>
            e.source &&
            e.target &&
            nodeIds.has(e.source) &&
            nodeIds.has(e.target),
        );
        if (wiredEdges.length > 0) {
          await tx.connection.createMany({
            data: wiredEdges.map((e) => ({
              workflowId: created.id,
              fromNodeId: e.source,
              toNodeId: e.target,
              fromOutput: e.sourceHandle ?? "main",
              toInput: e.targetHandle ?? "main",
            })),
          });
        }

        await tx.template.update({
          where: { slug: input.slug },
          data: { installs: { increment: 1 } },
        });

        return created;
      });

      return {
        workflowId: workflow.id,
        nodeCount: prepared.nodes.length,
        pendingCredentials: prepared.pendingCredentials,
        pendingSetup: prepared.pendingSetup,
      };
    }),
});
