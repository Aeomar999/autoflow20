import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { generateApiKey } from "@/features/api-keys/lib/key";
import { apiKeysRouter } from "@/features/api-keys/server/router";
import prisma from "@/lib/db";
import type { createTRPCContext } from "@/trpc/init";

/**
 * API key management router tests (AF-M8-01).
 *
 * Uses the org-procedure caller pattern (mocked session + seeded memberships,
 * mirroring org-isolation.integration.test.ts): `orgAdminProcedure` resolves
 * the org from the mocked session, so roles and cross-tenant rejection are
 * exercised here; the plaintext secret is returned once and never persisted.
 */
const h = vi.hoisted(() => {
  const adminA = { id: "usr_admin_a", email: "admina@test.local", name: "A" };
  const viewerA = {
    id: "usr_viewer_a",
    email: "viewera@test.local",
    name: "V",
  };
  const adminB = { id: "usr_admin_b", email: "adminb@test.local", name: "B" };
  return {
    headerMap: new Map<string, string>(),
    currentUser: { ...adminA },
    users: { adminA, viewerA, adminB },
  };
});

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: vi.fn(async () => ({ user: h.currentUser, session: {} })),
    },
  },
}));
vi.mock("next/headers", () => ({
  headers: vi.fn(() => h.headerMap),
}));

const dbUrl = process.env.TEST_DATABASE_URL;
const hasDb = Boolean(dbUrl);

describe.runIf(hasDb)("API key management router (AF-M8-01)", () => {
  const mockCtx = {} as unknown as ReturnType<typeof createTRPCContext>;
  const caller = apiKeysRouter.createCaller(mockCtx);

  let orgAId: string;
  let orgBId: string;

  function asUser(
    user: { id: string; email: string; name: string },
    orgHeader?: string,
  ) {
    h.currentUser = { ...user };
    h.headerMap.clear();
    if (orgHeader) h.headerMap.set("x-organization-id", orgHeader);
  }

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE "organization","member","invitation","workspace","WorkflowVersion","NodeExecution","Execution","Connection","Node","Workflow","Credential","user","session","account","verification","api_key","audit_log" CASCADE`,
    );
    asUser(h.users.adminA);

    await prisma.user.createMany({
      data: [h.users.adminA, h.users.viewerA, h.users.adminB],
    });

    const orgA = await prisma.organization.create({
      data: {
        name: "Org A",
        slug: "keys-org-a",
        members: {
          create: [
            { userId: h.users.adminA.id, role: "ADMIN" },
            { userId: h.users.viewerA.id, role: "VIEWER" },
          ],
        },
      },
      select: { id: true },
    });
    const orgB = await prisma.organization.create({
      data: {
        name: "Org B",
        slug: "keys-org-b",
        members: { create: { userId: h.users.adminB.id, role: "ADMIN" } },
      },
      select: { id: true },
    });
    orgAId = orgA.id;
    orgBId = orgB.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("create", () => {
    it("returns the plaintext secret once and stores only hash+prefix", async () => {
      const result = await caller.create({
        name: "CI deploy",
        scopes: ["workflows:read", "executions:read"],
      });

      expect(result.secret.startsWith("af_")).toBe(true);
      expect(result.key.name).toBe("CI deploy");
      expect(result.key.scopes.sort()).toEqual([
        "executions:read",
        "workflows:read",
      ]);

      const row = await prisma.apiKey.findUniqueOrThrow({
        where: { id: result.key.id },
      });
      // Storage holds the hash + prefix, never the secret.
      expect(row.hash).not.toContain(result.secret.slice(3));
      expect(row.prefix).toBe(result.key.prefix);
      expect(row.scopes).toContain("workflows:read");
      expect(row.revokedAt).toBeNull();
    });

    it("rejects an empty scope list", async () => {
      await expect(
        caller.create({ name: "no-scope", scopes: [] }),
      ).rejects.toThrow();
    });

    it("stores a createdById and audits the creation", async () => {
      const result = await caller.create({
        name: "audit-me",
        scopes: ["workflows:read"],
      });
      const row = await prisma.apiKey.findUniqueOrThrow({
        where: { id: result.key.id },
        select: { createdById: true },
      });
      expect(row.createdById).toBe(h.users.adminA.id);
      const audit = await prisma.auditLog.findFirst({
        where: { action: "apiKey.create", resourceId: result.key.id },
      });
      expect(audit).toBeTruthy();
      expect(audit?.actorId).toBe(h.users.adminA.id);
    });
  });

  describe("list", () => {
    it("never returns the hash", async () => {
      await caller.create({ name: "k1", scopes: ["workflows:read"] });
      await caller.create({ name: "k2", scopes: ["executions:read"] });
      const { items } = await caller.list();
      expect(items.length).toBe(2);
      for (const item of items) {
        // Both via toHaveProperty: `secret` is absent from the return type, so
        // `item.secret` does not compile. Asserting on the runtime shape keeps
        // the guarantee that matters — the field is not on the wire — and
        // still fails if someone widens the selection later.
        expect(item).not.toHaveProperty("hash");
        expect(item).not.toHaveProperty("secret");
      }
    });
  });

  describe("revoke", () => {
    it("revokes a key and audits it", async () => {
      const { key } = await caller.create({
        name: "to-revoke",
        scopes: ["workflows:read"],
      });
      const { key: revoked } = await caller.revoke({ id: key.id });
      expect(revoked.revokedAt).toBeTruthy();

      const audit = await prisma.auditLog.findFirst({
        where: { action: "apiKey.revoke", resourceId: key.id },
      });
      expect(audit).toBeTruthy();
    });

    it("rejects revoking a non-existent key with NOT_FOUND", async () => {
      await expect(
        caller.revoke({ id: "does-not-exist" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  describe("authorization", () => {
    it("forbids a VIEWER member from creating keys", async () => {
      asUser(h.users.viewerA);
      await expect(
        caller.create({ name: "nope", scopes: ["workflows:read"] }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("denies cross-tenant revoke with NOT_FOUND", async () => {
      asUser(h.users.adminA);
      const { key } = await caller.create({
        name: "org-a-key",
        scopes: ["workflows:read"],
      });
      asUser(h.users.adminB, orgBId);
      await expect(caller.revoke({ id: key.id })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });

  describe("security: hashed at rest lookup", () => {
    it("resolves a token by its hash, not the plaintext", async () => {
      const material = generateApiKey();
      await prisma.apiKey.create({
        data: {
          name: "hashed",
          prefix: material.prefix,
          hash: material.hash,
          scopes: "workflows:read",
          organizationId: orgAId,
        },
      });
      const row = await prisma.apiKey.findUnique({
        where: { hash: material.hash },
      });
      expect(row).toBeTruthy();
      expect(row?.hash).toBe(material.hash);
      // Plaintext is not retrievable from storage.
      expect(row?.hash).not.toContain(material.secret.slice(3));
    });
  });
});
