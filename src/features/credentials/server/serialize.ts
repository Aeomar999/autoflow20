import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import {
  CREDENTIAL_KINDS,
  CREDENTIAL_TYPE_IDS,
  credentialDefsById,
} from "../credential-types";

/**
 * Public credential -- the ONLY shape credential material ever leaves the
 * server in. No decrypted value, no envelope columns, nothing but metadata
 * and the write-time `preview` fragment. `.strict()` rejects unknown keys
 * (e.g. a hypothetical `value`), and every procedure that returns a
 * credential routes through `toPublicCredential` + `.output(...)` -- asserted
 * by `credentials-security.test.ts`.
 *
 * Spec: docs/architecture/security.md §3, docs/decisions/0008.
 */

export const credentialPublicSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    /** Registry id, e.g. "openai.apiKey". */
    type: z.enum(CREDENTIAL_TYPE_IDS),
    kind: z.enum(CREDENTIAL_KINDS),
    preview: z.string().nullable(),
    lastUsedAt: z.date().nullable(),
    oauthExpiresAt: z.date().nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
    usageCount: z.number().int().min(0),
  })
  .strict();

export type CredentialPublic = z.infer<typeof credentialPublicSchema>;

/** Columns returned for any credential-shaped row (list, getOne, mutations). */
export const credentialPublicSelect = {
  id: true,
  name: true,
  type: true,
  preview: true,
  lastUsedAt: true,
  oauthExpiresAt: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { Node: true } },
} satisfies Prisma.CredentialSelect;

export type CredentialPublicRow = Prisma.CredentialGetPayload<{
  select: typeof credentialPublicSelect;
}>;

export function toPublicCredential(row: CredentialPublicRow): CredentialPublic {
  return credentialPublicSchema.parse({
    id: row.id,
    name: row.name,
    type: row.type,
    kind: credentialDefsById.get(row.type)?.kind ?? "apiKey",
    preview: row.preview,
    lastUsedAt: row.lastUsedAt,
    oauthExpiresAt: row.oauthExpiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    usageCount: row._count.Node,
  });
}
