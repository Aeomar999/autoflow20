import { beforeEach, describe, expect, it, vi } from "vitest";
import { aiRouter } from "@/features/ai/server/routers";
import {
  buildAiCacheKey,
  purgeExpiredAiCache,
  readAiCache,
  writeAiCache,
} from "@/lib/ai/cache";
import prisma from "@/lib/db";
import type { createTRPCContext } from "@/trpc/init";

/**
 * AF-M5-07 against a real Postgres: the unique constraint, the TTL filter, and
 * — the one that matters — that a cache entry is unreachable from another
 * workspace even when the request fingerprint is byte-identical.
 */

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: vi
        .fn()
        .mockResolvedValue({ user: { id: "user_cache_a" }, session: {} }),
    },
  },
}));
vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Map()),
}));

const hasDb = Boolean(process.env.TEST_DATABASE_URL);

describe.runIf(hasDb)("AI response cache", () => {
  const mockCtx = {} as unknown as ReturnType<typeof createTRPCContext>;
  const caller = aiRouter.createCaller(mockCtx);

  const cacheKey = buildAiCacheKey({
    nodeType: "AI_LLM",
    candidates: ["openai:gpt-4o"],
    system: "You are helpful.",
    prompt: "Summarise the invoice.",
    params: { temperature: 0.7 },
  });

  let orgA: string;
  let orgB: string;
  let workflowId: string;

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE "AiResponseCache","organization","member","invitation","workspace","WorkflowVersion","NodeExecution","Execution","Connection","Node","Workflow","Credential","user","session","account","verification" CASCADE`,
    );

    await prisma.user.create({
      data: {
        id: "user_cache_a",
        email: "cache-a@test.local",
        name: "Cache A",
        emailVerified: true,
      },
    });

    const a = await prisma.organization.create({
      data: {
        name: "Org A",
        slug: "cache-org-a",
        members: { create: { userId: "user_cache_a", role: "OWNER" } },
      },
    });
    const b = await prisma.organization.create({
      data: { name: "Org B", slug: "cache-org-b" },
    });
    orgA = a.id;
    orgB = b.id;

    const workflow = await prisma.workflow.create({
      data: {
        name: "Cached WF",
        userId: "user_cache_a",
        organizationId: orgA,
      },
    });
    workflowId = workflow.id;
  });

  const seedEntry = async (organizationId: string, value: unknown) =>
    writeAiCache({
      organizationId,
      cacheKey,
      nodeType: "AI_LLM",
      model: "openai:gpt-4o",
      value,
      tokensIn: 1000,
      tokensOut: 500,
      costUsd: 0.0075,
      ttlSeconds: 600,
    });

  it("round-trips a stored response and counts the hit", async () => {
    await seedEntry(orgA, "org A answer");

    const hit = await readAiCache({ organizationId: orgA, cacheKey });

    expect(hit?.value).toBe("org A answer");
    expect(hit?.costUsd).toBe(0.0075);

    const row = await prisma.aiResponseCache.findFirst({
      where: { organizationId: orgA, cacheKey },
    });
    expect(row?.hitCount).toBe(1);
    expect(row?.lastHitAt).not.toBeNull();
  });

  it("does not serve one workspace's entry to another", async () => {
    await seedEntry(orgA, "org A answer");

    expect(await readAiCache({ organizationId: orgB, cacheKey })).toBeNull();

    await seedEntry(orgB, "org B answer");
    const fromB = await readAiCache({ organizationId: orgB, cacheKey });
    const fromA = await readAiCache({ organizationId: orgA, cacheKey });

    expect(fromB?.value).toBe("org B answer");
    expect(fromA?.value).toBe("org A answer");
    expect(await prisma.aiResponseCache.count()).toBe(2);
  });

  it("treats an elapsed TTL as a miss and sweeps it away", async () => {
    await seedEntry(orgA, "stale answer");
    await prisma.aiResponseCache.updateMany({
      where: { organizationId: orgA, cacheKey },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    expect(await readAiCache({ organizationId: orgA, cacheKey })).toBeNull();
    expect(await purgeExpiredAiCache()).toBe(1);
    expect(await prisma.aiResponseCache.count()).toBe(0);
  });

  it("replaces an entry on rewrite instead of duplicating it", async () => {
    await seedEntry(orgA, "first answer");
    await readAiCache({ organizationId: orgA, cacheKey });
    await seedEntry(orgA, "second answer");

    const rows = await prisma.aiResponseCache.findMany({
      where: { organizationId: orgA },
    });
    expect(rows).toHaveLength(1);
    expect((rows[0].response as { value: string }).value).toBe("second answer");
    expect(rows[0].hitCount).toBe(0);
  });

  describe("cacheStats", () => {
    const seedNodeRun = async (cacheHit: boolean | null) => {
      const execution = await prisma.execution.create({
        data: {
          workflowId,
          organizationId: orgA,
          inngestEventId: `evt_${Math.random().toString(36).slice(2)}`,
        },
      });
      await prisma.nodeExecution.create({
        data: {
          executionId: execution.id,
          nodeId: "n1",
          nodeName: "AI Chat",
          nodeType: "AI_LLM",
          status: "SUCCESS",
          order: 0,
          cacheHit,
        },
      });
    };

    it("reports the hit rate over runs that actually asked the cache", async () => {
      await seedNodeRun(true);
      await seedNodeRun(true);
      await seedNodeRun(false);
      await seedNodeRun(null);

      const stats = await caller.cacheStats({ days: 30 });

      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
      expect(stats.uncachedRuns).toBe(1);
      expect(stats.hitRate).toBeCloseTo(2 / 3, 5);
    });

    it("reports the spend the live entries have avoided", async () => {
      await seedEntry(orgA, "org A answer");
      await readAiCache({ organizationId: orgA, cacheKey });
      await readAiCache({ organizationId: orgA, cacheKey });

      const stats = await caller.cacheStats({ days: 30 });

      expect(stats.entries).toBe(1);
      expect(stats.savedUsd).toBeCloseTo(0.015, 6);
    });

    it("counts neither entries nor runs belonging to another workspace", async () => {
      await seedEntry(orgB, "org B answer");
      await readAiCache({ organizationId: orgB, cacheKey });

      const stats = await caller.cacheStats({ days: 30 });

      expect(stats.entries).toBe(0);
      expect(stats.savedUsd).toBe(0);
      expect(stats.hits).toBe(0);
    });
  });

  it("clearCache drops only this workspace's entries", async () => {
    await seedEntry(orgA, "org A answer");
    await seedEntry(orgB, "org B answer");

    const { deletedCount } = await caller.clearCache({ expiredOnly: false });

    expect(deletedCount).toBe(1);
    expect(
      await prisma.aiResponseCache.count({ where: { organizationId: orgB } }),
    ).toBe(1);
    expect(
      await prisma.aiResponseCache.count({ where: { organizationId: orgA } }),
    ).toBe(0);
  });
});
