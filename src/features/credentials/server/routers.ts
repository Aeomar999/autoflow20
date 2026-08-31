import { z } from "zod";
import { PAGINATION } from "@/config/constants";
import prisma from "@/lib/db";
import {
  createTRPCRouter,
  orgEditorProcedure,
  orgViewerProcedure,
  premiumOrgProcedure,
} from "@/trpc/init";
import {
  computePreview,
  credentialRegistry,
  secretFromInput,
} from "../credential-registry";
import {
  credentialPublicSchema,
  credentialPublicSelect,
  toPublicCredential,
} from "./serialize";
import { openSecret, sealSecret } from "./vault";
import {
  credentialUpdateInput,
  credentialWriteInput,
  hasSecretChanges,
  oauthExpiresAtOf,
} from "./write-schema";

/**
 * Credentials router (AF-M3-02). [HARD]
 * - No procedure returns decrypted material: `value` no longer exists on the
 *   model; secrets live only in the envelope columns and the write-time
 *   `preview` fragment. Asserted by credentials-security.test.ts.
 * - Every query is tenant-scoped in the `where` clause (`organizationId`,
 *   via the org procedures; AF-M7-pre-1).
 * - `type` is a credential-registry id (e.g. "openai.apiKey"); the write input
 *   schema is generated from the registry so secret shape can only diverge by
 *   adding a new type.
 *
 * Spec: docs/architecture/security.md §3, docs/architecture/api_contract.md
 * §3, docs/decisions/0008.
 */

const credentialIdInput = z.object({ id: z.string() });

const credentialListOutput = z.object({
  items: z.array(credentialPublicSchema),
  page: z.number(),
  pageSize: z.number(),
  totalCount: z.number(),
  totalPages: z.number(),
  hasNextPage: z.boolean(),
  hasPreviousPage: z.boolean(),
});

const credentialRemovedOutput = z.object({ id: z.string() });

const credentialTestOutput = z.union([
  z.object({ ok: z.literal(true) }),
  z.object({
    ok: z.literal(false),
    error: z.enum(["AUTH", "CONNECTION", "TIMEOUT", "NOT_TESTABLE"]),
  }),
]);

/** Encrypt the write-time secret set into the envelope columns + preview. */
const upsertSecretColumns = (input: z.infer<typeof credentialWriteInput>) => {
  const def = credentialRegistry.resolve(input.type);
  const secret = secretFromInput(def, input);
  const envelope = sealSecret(secret);
  return {
    ...envelope,
    preview: computePreview(def, secret),
    oauthExpiresAt: oauthExpiresAtOf(input),
  };
};

export const credentialsRouter = createTRPCRouter({
  create: premiumOrgProcedure
    .input(credentialWriteInput)
    .output(credentialPublicSchema)
    .mutation(async ({ ctx, input }) => {
      const credential = await prisma.credential.create({
        data: {
          name: input.name,
          userId: ctx.auth.user.id,
          organizationId: ctx.org.id,
          type: input.type,
          ...upsertSecretColumns(input),
        },
        select: credentialPublicSelect,
      });
      return toPublicCredential(credential);
    }),
  /**
   * Update a credential. Secret fields are optional — when omitted or blank
   * the existing envelope is preserved (name-only rename). When any secret
   * field is provided, the entire envelope is re-encrypted.
   */
  update: orgEditorProcedure
    .input(credentialUpdateInput)
    .output(credentialPublicSchema)
    .mutation(async ({ ctx, input }) => {
      const { id, name, type, ...rest } = input;
      const def = credentialRegistry.resolve(type);
      const fieldKeys = def.fields.map((f) => f.key);
      const secretsChanged = hasSecretChanges(
        rest as Record<string, unknown>,
        fieldKeys,
      );

      let envelopeData: Record<string, unknown> = {};
      if (secretsChanged) {
        // Re-encrypt: build a full write payload from the provided fields.
        // Missing required fields in this path will fail at secretFromInput.
        const secret = secretFromInput(def, input);
        const envelope = sealSecret(secret);
        envelopeData = {
          ...envelope,
          preview: computePreview(def, secret),
          oauthExpiresAt: oauthExpiresAtOf(input),
        };
      }

      const credential = await prisma.credential.update({
        where: { id, organizationId: ctx.org.id },
        data: { name, type, ...envelopeData },
        select: credentialPublicSelect,
      });
      return toPublicCredential(credential);
    }),
  /**
   * Returns workflows that reference a credential (via Node.credentialId).
   * Used by the UI's delete-confirmation dialog to warn the user.
   */
  getUsage: orgViewerProcedure
    .input(credentialIdInput)
    .output(
      z.object({
        workflows: z.array(z.object({ id: z.string(), name: z.string() })),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Verify ownership first
      await prisma.credential.findUniqueOrThrow({
        where: { id: input.id, organizationId: ctx.org.id },
        select: { id: true },
      });

      const nodes = await prisma.node.findMany({
        where: {
          credentialId: input.id,
          workflow: { organizationId: ctx.org.id },
        },
        select: {
          workflow: { select: { id: true, name: true } },
        },
        distinct: ["workflowId"],
      });

      return {
        workflows: nodes.map((node) => ({
          id: node.workflow.id,
          name: node.workflow.name,
        })),
      };
    }),
  remove: orgEditorProcedure
    .input(credentialIdInput)
    .output(credentialRemovedOutput)
    .mutation(async ({ ctx, input }) => {
      const credential = await prisma.credential.delete({
        where: { id: input.id, organizationId: ctx.org.id },
        select: { id: true },
      });
      return credential;
    }),
  getOne: orgViewerProcedure
    .input(credentialIdInput)
    .output(credentialPublicSchema)
    .query(async ({ ctx, input }) => {
      const credential = await prisma.credential.findUniqueOrThrow({
        where: { id: input.id, organizationId: ctx.org.id },
        select: credentialPublicSelect,
      });
      return toPublicCredential(credential);
    }),
  list: orgViewerProcedure
    .input(
      z
        .object({
          page: z.number().default(PAGINATION.DEFAULT_PAGE),
          pageSize: z
            .number()
            .min(PAGINATION.MIN_PAGE_SIZE)
            .max(PAGINATION.MAX_PAGE_SIZE)
            .default(PAGINATION.DEFAULT_PAGE_SIZE),
          search: z.string().default(""),
          type: z
            .string()
            .optional()
            .refine((t) => t === undefined || credentialRegistry.has(t), {
              message: "Unknown credential type",
            }),
        })
        .strip(),
    )
    .output(credentialListOutput)
    .query(async ({ ctx, input }) => {
      const { page, pageSize, search, type } = input;
      const where = {
        organizationId: ctx.org.id,
        type,
        name: {
          contains: search,
          mode: "insensitive" as const,
        },
      };

      const [items, totalCount] = await Promise.all([
        prisma.credential.findMany({
          skip: (page - 1) * pageSize,
          take: pageSize,
          where,
          orderBy: { updatedAt: "desc" },
          select: credentialPublicSelect,
        }),
        prisma.credential.count({ where }),
      ]);

      const totalPages = Math.ceil(totalCount / pageSize);
      const hasNextPage = page < totalPages;
      const hasPreviousPage = page > 1;

      return {
        items: items.map(toPublicCredential),
        page,
        pageSize,
        totalCount,
        totalPages,
        hasNextPage,
        hasPreviousPage,
      };
    }),
  /**
   * Validates a credential against its provider (registry testers). Returns
   * only { ok } or { ok:false, error }; never request details, and never
   * materializes the secret for the client. On success records `lastUsedAt`
   * for audits.
   */
  test: orgEditorProcedure
    .input(
      z.object({
        id: z.string(),
      }),
    )
    .output(credentialTestOutput)
    .mutation(async ({ ctx, input }) => {
      const credential = await prisma.credential.findUniqueOrThrow({
        where: { id: input.id, organizationId: ctx.org.id },
      });

      const def = credentialRegistry.resolve(credential.type);
      if (!credentialRegistry.isTestable(def.type)) {
        return { ok: false, error: "NOT_TESTABLE" as const };
      }

      const secret = openSecret(credential);
      const result = await credentialRegistry.tester(def.type)(secret);

      if (result.ok) {
        await prisma.credential.update({
          where: { id: credential.id, organizationId: ctx.org.id },
          data: { lastUsedAt: new Date() },
        });
      }
      return result;
    }),
});
