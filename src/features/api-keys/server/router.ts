import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  generateApiKey,
  isKnownApiKeyScope,
  KNOWN_API_KEY_SCOPES,
  parseScopes,
  serializeScopes,
} from "@/features/api-keys/lib/key";
import { logAuditEvent } from "@/lib/audit";
import prisma from "@/lib/db";
import { createTRPCRouter, orgAdminProcedure } from "@/trpc/init";

/**
 * API key management surface (AF-M8-01).
 *
 * Org-admins create, list, and revoke their workspace's keys. The plaintext
 * `af_...` secret is returned ONLY by `create` and only once - storage holds
 * just the hash and an 8-char support prefix (ADR-0012 §1). The hash itself is
 * never returned by any procedure, and a revoked/expired key cannot be re-read.
 * Every mutation is audit-logged.
 */

const apiKeyScopeSchema = z.enum(KNOWN_API_KEY_SCOPES);

const apiKeyMeta = z.object({
  id: z.string(),
  name: z.string(),
  prefix: z.string(),
  scopes: z.array(apiKeyScopeSchema),
  createdAt: z.date(),
  lastUsedAt: z.date().nullable(),
  expiresAt: z.date().nullable(),
  revokedAt: z.date().nullable(),
});

const NAME_MAX = 64;

function toMeta(row: {
  id: string;
  name: string;
  prefix: string;
  scopes: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
}) {
  return apiKeyMeta.parse({
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    scopes: parseScopes(row.scopes).filter(isKnownApiKeyScope).sort(),
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
  });
}

export const apiKeysRouter = createTRPCRouter({
  /** Create a key; returns the plaintext secret exactly once. */
  create: orgAdminProcedure
    .input(
      z.object({
        name: z
          .string()
          .trim()
          .min(1, "Name is required")
          .max(NAME_MAX, `Name must be ${NAME_MAX} characters or fewer`),
        scopes: z
          .array(apiKeyScopeSchema)
          .min(1, "At least one scope is required"),
        expiresAt: z
          .date()
          .refine((d) => d > new Date(), "Expiry must be in the future")
          .optional(),
      }),
    )
    .output(
      z.object({
        key: apiKeyMeta,
        secret: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const material = generateApiKey();
      const key = await prisma.apiKey.create({
        data: {
          name: input.name,
          prefix: material.prefix,
          hash: material.hash,
          scopes: serializeScopes(input.scopes),
          organizationId: ctx.org.id,
          createdById: ctx.auth.user.id,
          ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
        },
        select: {
          id: true,
          name: true,
          prefix: true,
          scopes: true,
          createdAt: true,
          lastUsedAt: true,
          expiresAt: true,
          revokedAt: true,
        },
      });

      await logAuditEvent({
        organizationId: ctx.org.id,
        actorId: ctx.auth.user.id,
        action: "apiKey.create",
        resourceType: "api_key",
        resourceId: key.id,
        after: {
          name: key.name,
          scopes: input.scopes,
          expiresAt: input.expiresAt ?? null,
        },
      });

      return { key: toMeta(key), secret: material.secret };
    }),

  /** List the org's keys. Never includes the hash or any secret. */
  list: orgAdminProcedure
    .output(z.object({ items: z.array(apiKeyMeta) }))
    .query(async ({ ctx }) => {
      const rows = await prisma.apiKey.findMany({
        where: { organizationId: ctx.org.id },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          name: true,
          prefix: true,
          scopes: true,
          createdAt: true,
          lastUsedAt: true,
          expiresAt: true,
          revokedAt: true,
        },
      });
      return { items: rows.map(toMeta) };
    }),

  /** Revoke a key. Cross-tenant is NOT_FOUND. */
  revoke: orgAdminProcedure
    .input(z.object({ id: z.string() }))
    .output(z.object({ key: apiKeyMeta }))
    .mutation(async ({ ctx, input }) => {
      const row = await prisma.apiKey.findFirst({
        where: { id: input.id, organizationId: ctx.org.id },
        select: {
          id: true,
          name: true,
          prefix: true,
          scopes: true,
          createdAt: true,
          lastUsedAt: true,
          expiresAt: true,
          revokedAt: true,
        },
      });
      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "API key not found",
        });
      }
      if (row.revokedAt !== null) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "API key is already revoked",
        });
      }

      const updated = await prisma.apiKey.update({
        where: { id: row.id },
        data: { revokedAt: new Date() },
        select: {
          id: true,
          name: true,
          prefix: true,
          scopes: true,
          createdAt: true,
          lastUsedAt: true,
          expiresAt: true,
          revokedAt: true,
        },
      });

      await logAuditEvent({
        organizationId: ctx.org.id,
        actorId: ctx.auth.user.id,
        action: "apiKey.revoke",
        resourceType: "api_key",
        resourceId: row.id,
        before: { name: row.name },
        after: { revokedAt: updated.revokedAt },
      });

      return { key: toMeta(updated) };
    }),
});
