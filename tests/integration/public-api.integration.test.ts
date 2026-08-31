import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  generateApiKey,
  KNOWN_API_KEY_SCOPES,
  serializeScopes,
} from "@/features/api-keys/lib/key";
import prisma from "@/lib/db";

/**
 * Public REST API v1 route tests (AF-M8-01).
 *
 * These exercise the `/api/v1/*` route handlers directly with real Postgres
 * (TEST_DATABASE_URL — see docs/engineering/testing_strategy.md §4). Auth is
 * bearer API keys seeded here via Prisma: `generateApiKey()` yields a known
 * hash we store and a secret we keep in-memory for the header, so the route
 * resolves the key exactly as production would. Sessions are not involved.
 *
 * Coverage: happy path, auth failures, scope rejection, cross-tenant
 * isolation (NOT_FOUND), run idempotency, cancellation, and rate limiting.
 */
const dbUrl = process.env.TEST_DATABASE_URL;
const hasDb = Boolean(dbUrl);

// External boundary: the run endpoint emits an Inngest event. Assert instead
// of deliver; a test that enqueues real events is not a test.
vi.mock("@/inngest/utils", () => ({
  sendWorkflowExecution: vi.fn().mockResolvedValue({ eventId: "evt_api_test" }),
  topologicalSort: vi.fn(),
}));

const { GET: listWorkflows } = await import("@/app/api/v1/workflows/route");
const { GET: getWorkflow } = await import("@/app/api/v1/workflows/[id]/route");
const { POST: runWorkflow } = await import(
  "@/app/api/v1/workflows/[id]/run/route"
);
const { GET: listExecutions } = await import("@/app/api/v1/executions/route");
const { GET: getExecution } = await import(
  "@/app/api/v1/executions/[id]/route"
);
const { POST: cancelExecution } = await import(
  "@/app/api/v1/executions/[id]/cancel/route"
);

describe.runIf(hasDb)("Public REST API v1 (AF-M8-01)", () => {
  let orgAId: string;
  let orgBId: string;
  // keyA is all-scoped for org A (PRO plan, high limit); keyB all-scoped for
  // org B; readOnlyKey carries only workflows:read; freeKey is FREE-plan for
  // the rate-limit case.
  let keyA: string;
  let keyB: string;
  let readOnlyKey: string;
  let freeKey: string;
  let wfAId: string;
  let wfBId: string;
  let exAId: string;
  let exA2Id: string;
  let exBId: string;

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Persist an API key for an org and return its in-memory secret. */
  async function seedKey(
    orgId: string,
    scopes: string[],
    extra: { plan?: string; revokedAt?: Date; expiresAt?: Date } = {},
  ): Promise<string> {
    const material = generateApiKey();
    if (extra.plan) {
      await prisma.organization.update({
        where: { id: orgId },
        data: { plan: extra.plan as never },
      });
    }
    await prisma.apiKey.create({
      data: {
        name: "test-key",
        prefix: material.prefix,
        hash: material.hash,
        scopes: serializeScopes(scopes),
        organizationId: orgId,
        ...(extra.revokedAt ? { revokedAt: extra.revokedAt } : {}),
        ...(extra.expiresAt ? { expiresAt: extra.expiresAt } : {}),
      },
    });
    return material.secret;
  }

  /**
   * Build the request the route handlers actually receive. `NextRequest`, not
   * a bare `Request`: every handler is typed `(req: NextRequest)`, so passing
   * a plain `Request` only compiled behind an `as never` — which silenced the
   * type system on the one boundary these tests exist to exercise.
   */
  function api(
    path: string,
    opts: {
      method?: string;
      token?: string;
      body?: unknown;
      headers?: Record<string, string>;
    } = {},
  ): NextRequest {
    return new NextRequest(`http://localhost${path}`, {
      method: opts.method ?? "GET",
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
      headers: {
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
        ...(opts.headers ?? {}),
      },
    });
  }

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE "organization","member","invitation","workspace","WorkflowVersion","NodeExecution","Execution","Connection","Node","Workflow","Credential","user","session","account","verification","api_key" CASCADE`,
    );

    await prisma.user.createMany({
      data: [
        { id: "usr_api_a", name: "User A", email: "ua@api.local" },
        { id: "usr_api_b", name: "User B", email: "ub@api.local" },
      ],
    });

    const orgA = await prisma.organization.create({
      data: { name: "Org A", slug: "api-org-a", plan: "PRO" },
      select: { id: true },
    });
    const orgB = await prisma.organization.create({
      data: { name: "Org B", slug: "api-org-b", plan: "PRO" },
      select: { id: true },
    });
    const orgFree = await prisma.organization.create({
      data: { name: "Org Free", slug: "api-org-free", plan: "FREE" },
      select: { id: true },
    });
    orgAId = orgA.id;
    orgBId = orgB.id;

    const wfA = await prisma.workflow.create({
      data: { name: "wf-a", userId: "usr_api_a", organizationId: orgAId },
      select: { id: true },
    });
    const wfB = await prisma.workflow.create({
      data: { name: "wf-b", userId: "usr_api_b", organizationId: orgBId },
      select: { id: true },
    });
    wfAId = wfA.id;
    wfBId = wfB.id;

    const mk = (wfId: string) =>
      prisma.execution.create({
        data: {
          workflowId: wfId,
          trigger: "MANUAL",
          mode: "PRODUCTION",
          status: "SUCCESS",
          inngestEventId: Math.random().toString(36).slice(2),
        },
        select: { id: true },
      });
    exAId = (await mk(wfAId)).id;
    exA2Id = (await mk(wfAId)).id;
    exBId = (await mk(wfBId)).id;

    keyA = await seedKey(orgAId, [...KNOWN_API_KEY_SCOPES]);
    keyB = await seedKey(orgBId, [...KNOWN_API_KEY_SCOPES]);
    readOnlyKey = await seedKey(orgAId, ["workflows:read"]);
    freeKey = await seedKey(orgFree.id, [...KNOWN_API_KEY_SCOPES]);
  });

  describe("authentication", () => {
    it("rejects a missing Authorization header with 401", async () => {
      const res = await listWorkflows(api("/api/v1/workflows"));
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error.code).toBe("UNAUTHENTICATED");
    });

    it("rejects a malformed header with 401", async () => {
      const res = await listWorkflows(
        api("/api/v1/workflows", { token: "no-bearer-scheme" }),
      );
      expect(res.status).toBe(401);
    });

    it("rejects an unknown token with 401", async () => {
      const res = await listWorkflows(
        api("/api/v1/workflows", { token: "af_NotARealStoredToken" }),
      );
      expect(res.status).toBe(401);
    });

    it("rejects a revoked key with 401", async () => {
      const revokedKey = await seedKey(orgAId, [...KNOWN_API_KEY_SCOPES], {
        revokedAt: new Date(),
      });
      const res = await listWorkflows(
        api("/api/v1/workflows", { token: revokedKey }),
      );
      expect(res.status).toBe(401);
    });

    it("rejects an expired key with 401", async () => {
      const expiredKey = await seedKey(orgAId, [...KNOWN_API_KEY_SCOPES], {
        expiresAt: new Date(Date.now() - 1000),
      });
      const res = await listWorkflows(
        api("/api/v1/workflows", { token: expiredKey }),
      );
      expect(res.status).toBe(401);
    });
  });

  describe("authorization / scopes", () => {
    it("rejects a missing scope with 403 FORBIDDEN", async () => {
      const res = await listExecutions(
        api("/api/v1/executions", { token: readOnlyKey }),
      );
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe("FORBIDDEN");
      expect(body.error.message).toContain("executions:read");
    });

    it("allows a key that has the required scope", async () => {
      const res = await listWorkflows(
        api("/api/v1/workflows", { token: keyA }),
      );
      expect(res.status).toBe(200);
    });
  });

  describe("workflows", () => {
    it("lists only the key's own org workflows (tenant isolation)", async () => {
      const res = await listWorkflows(
        api("/api/v1/workflows", { token: keyA }),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0]).toMatchObject({
        id: wfAId,
        name: "wf-a",
      });
      // snake_case at the boundary
      expect(body.data[0].created_at).toBeDefined();
      expect(body.data[0].createdAt).toBeUndefined();
    });

    it("returning another org's workflow id is NOT_FOUND", async () => {
      const res = await getWorkflow(
        api(`/api/v1/workflows/${wfBId}`, { token: keyA }),
        { params: Promise.resolve({ id: wfBId }) },
      );
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe("NOT_FOUND");
    });

    it("org B's key reads org B's workflow but not org A's", async () => {
      const own = await getWorkflow(
        api(`/api/v1/workflows/${wfBId}`, { token: keyB }),
        { params: Promise.resolve({ id: wfBId }) },
      );
      expect(own.status).toBe(200);
      const other = await getWorkflow(
        api(`/api/v1/workflows/${wfAId}`, { token: keyB }),
        { params: Promise.resolve({ id: wfAId }) },
      );
      expect(other.status).toBe(404);
    });
  });

  describe("executions", () => {
    it("lists only the key's own org executions (tenant isolation)", async () => {
      const res = await listExecutions(
        api("/api/v1/executions", { token: keyA }),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      const ids = body.data.map((e: { id: string }) => e.id);
      expect(ids).toEqual(expect.arrayContaining([exAId, exA2Id]));
      expect(ids).not.toContain(exBId);
    });

    it("returns a single execution with snake_case cost", async () => {
      const res = await getExecution(
        api(`/api/v1/executions/${exAId}`, { token: keyA }),
        { params: Promise.resolve({ id: exAId }) },
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ id: exAId, workflow_id: wfAId });
      expect(typeof body.cost_usd).toBe("number");
      expect(body.costUsd).toBeUndefined();
    });

    it("another org's execution is NOT_FOUND", async () => {
      const res = await getExecution(
        api(`/api/v1/executions/${exBId}`, { token: keyA }),
        { params: Promise.resolve({ id: exBId }) },
      );
      expect(res.status).toBe(404);
    });
  });

  describe("POST /workflows/:id/run + idempotency", () => {
    it("creates a run and returns execution_id", async () => {
      const send = vi.mocked(
        (await import("@/inngest/utils")).sendWorkflowExecution,
      );
      const res = await runWorkflow(
        api(`/api/v1/workflows/${wfAId}/run`, {
          method: "POST",
          token: keyA,
          body: { input: { hello: "world" } },
          headers: { "content-type": "application/json" },
        }),
        { params: Promise.resolve({ id: wfAId }) },
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(typeof body.execution_id).toBe("string");
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowId: wfAId,
          initialData: { hello: "world" },
        }),
      );
    });

    it("is idempotent across retries with the same Idempotency-Key", async () => {
      const first = await runWorkflow(
        api(`/api/v1/workflows/${wfAId}/run`, {
          method: "POST",
          token: keyA,
          body: {},
          headers: { "idempotency-key": "dup-run-1" },
        }),
        { params: Promise.resolve({ id: wfAId }) },
      );
      const second = await runWorkflow(
        api(`/api/v1/workflows/${wfAId}/run`, {
          method: "POST",
          token: keyA,
          body: {},
          headers: { "idempotency-key": "dup-run-1" },
        }),
        { params: Promise.resolve({ id: wfAId }) },
      );
      const a = await first.json();
      const b = await second.json();
      expect(a.execution_id).toBe(b.execution_id);
    });

    it("creates distinct runs for distinct Idempotency-Keys", async () => {
      const first = await runWorkflow(
        api(`/api/v1/workflows/${wfAId}/run`, {
          method: "POST",
          token: keyA,
          headers: { "idempotency-key": "k-1" },
        }),
        { params: Promise.resolve({ id: wfAId }) },
      );
      const second = await runWorkflow(
        api(`/api/v1/workflows/${wfAId}/run`, {
          method: "POST",
          token: keyA,
          headers: { "idempotency-key": "k-2" },
        }),
        { params: Promise.resolve({ id: wfAId }) },
      );
      const a = await first.json();
      const b = await second.json();
      expect(a.execution_id).not.toBe(b.execution_id);
    });

    it("running another org's workflow is NOT_FOUND", async () => {
      const res = await runWorkflow(
        api(`/api/v1/workflows/${wfBId}/run`, {
          method: "POST",
          token: keyA,
        }),
        { params: Promise.resolve({ id: wfBId }) },
      );
      expect(res.status).toBe(404);
    });
  });

  describe("POST /executions/:id/cancel", () => {
    it("cancels a RUNNING execution", async () => {
      const running = await prisma.execution.create({
        data: {
          workflowId: wfAId,
          trigger: "API",
          mode: "PRODUCTION",
          status: "RUNNING",
          inngestEventId: Math.random().toString(36).slice(2),
        },
        select: { id: true },
      });
      const res = await cancelExecution(
        api(`/api/v1/executions/${running.id}/cancel`, {
          method: "POST",
          token: keyA,
        }),
        { params: Promise.resolve({ id: running.id }) },
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("CANCELLED");
      expect(body.completed_at).toBeTruthy();
    });

    it("refuses to cancel a terminal execution with 409", async () => {
      const res = await cancelExecution(
        api(`/api/v1/executions/${exAId}/cancel`, {
          method: "POST",
          token: keyA,
        }),
        { params: Promise.resolve({ id: exAId }) },
      );
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error.code).toBe("CONFLICT");
    });

    it("another org's execution is NOT_FOUND", async () => {
      const res = await cancelExecution(
        api(`/api/v1/executions/${exBId}/cancel`, {
          method: "POST",
          token: keyA,
        }),
        { params: Promise.resolve({ id: exBId }) },
      );
      expect(res.status).toBe(404);
    });
  });

  describe("rate limiting", () => {
    it("returns 429 + Retry-After once a FREE-plan key exhausts its bucket", async () => {
      const cap = 60; // FREE bucket capacity
      let status = 0;
      let lastErrorCode = "";
      for (let i = 0; i <= cap; i++) {
        const res = await listWorkflows(
          api("/api/v1/workflows", { token: freeKey }),
        );
        status = res.status;
        if (status === 429) {
          lastErrorCode = (await res.json()).error.code;
          expect(res.headers.get("retry-after")).toBeTruthy();
          break;
        }
      }
      expect(status).toBe(429);
      expect(lastErrorCode).toBe("TOO_MANY_REQUESTS");
    });
  });
});
