import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TemplateGraph } from "@/features/templates/server/instantiate";
import { ExecutionStatus, type Prisma } from "@/generated/prisma/client";
import prisma from "@/lib/db";
import { runGraph } from "./engine/run-graph";

/**
 * AF-M9-10 (G3) — `RESPOND_TO_WEBHOOK` and real synchronous webhook responses.
 *
 * Two halves, both against a real Postgres:
 *
 *  1. **Engine.** A respond node's composed response reaches
 *     `Execution.response`, is written eagerly (so it survives a later
 *     failure), and stays NULL when no respond node runs.
 *  2. **Route.** `?sync=true` returns that response verbatim — status, content
 *     type, headers, body — and falls back to the legacy
 *     `{success, executionId}` envelope when there is none.
 *
 * The route half stands the engine down and drives the Execution row from the
 * `sendWorkflowExecution` mock: the route's contract is "poll the row, return
 * what you find", and that is exactly what is under test here.
 */
const hasDb = Boolean(process.env.TEST_DATABASE_URL);

vi.mock("@/inngest/utils", () => ({
  sendWorkflowExecution: vi.fn().mockResolvedValue({ eventId: "evt_rtw" }),
}));

const { sendWorkflowExecution } = await import("@/inngest/utils");
const routeModule = await import(
  "@/app/api/webhooks/[workflowId]/[path]/route"
);

/**
 * `Workflow.webhookSecret` is globally unique, so every seeded workflow needs
 * its own — a shared constant collides on the second test in the file.
 */
let secretCounter = 0;
const nextSecret = () => `secret_rtw_${Date.now()}_${secretCounter++}`;

/** Settle the execution the route just created, as the engine would. */
function settleWith(
  status: ExecutionStatus,
  response: Record<string, unknown> | null,
) {
  (sendWorkflowExecution as unknown as ReturnType<typeof vi.fn>)
    .mockReset()
    .mockImplementation(async ({ executionId }: { executionId: string }) => {
      await prisma.execution.update({
        where: { id: executionId },
        data: {
          status,
          ...(response
            ? { response: response as unknown as Prisma.InputJsonValue }
            : {}),
        },
      });
      // `Execution.inngestEventId` is @unique and the route writes this value
      // onto the row, so a constant here makes the second request in a test
      // collide — which surfaces as a 500 that looks like a route bug.
      return { eventId: nextSecret() };
    });
}

async function seedWorkflow(): Promise<{
  workflowId: string;
  secret: string;
}> {
  const secret = nextSecret();
  const userId = `user_rtw_${secret}`;
  await prisma.user.createMany({
    data: [{ id: userId, name: "RTW", email: `${userId}@test.local` }],
    skipDuplicates: true,
  });
  const org = await prisma.organization.create({
    data: {
      name: "RTW Org",
      slug: `rtw-${secret}`,
      members: { create: { userId, role: "OWNER" } },
    },
    select: { id: true },
  });
  const version = await prisma.workflowVersion.create({
    data: {
      version: 1,
      workflowRevision: 1,
      graphSnapshot: { nodes: [], connections: [] },
      workflow: {
        create: {
          name: "rtw-wf",
          userId,
          organizationId: org.id,
          webhookSecret: secret,
        },
      },
    },
    select: { id: true, workflowId: true },
  });
  await prisma.workflow.update({
    where: { id: version.workflowId },
    data: { activeVersionId: version.id },
  });
  return { workflowId: version.workflowId, secret };
}

const call = async (
  workflowId: string,
  query: string,
  init: RequestInit = {},
) => {
  const request = new Request(
    `https://app.test/api/webhooks/${workflowId}/hook${query}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hello: "world" }),
      ...init,
    },
  ) as never;
  const method = ((init.method as string) ?? "POST") as
    | "POST"
    | "GET"
    | "PUT"
    | "PATCH"
    | "DELETE";
  return routeModule[method](request, {
    params: Promise.resolve({ workflowId, path: "hook" }),
  });
};

describe.skipIf(!hasDb)("AF-M9-10 · engine writes Execution.response", () => {
  beforeEach(async () => {
    await prisma.nodeExecution.deleteMany({});
    await prisma.execution.deleteMany({});
  });

  it("persists the response a RESPOND_TO_WEBHOOK node composed", async () => {
    const graph: TemplateGraph = {
      nodes: [
        {
          id: "trigger",
          type: "WEBHOOK_TRIGGER",
          name: "Inbound",
          position: { x: 0, y: 0 },
          data: {},
        },
        {
          id: "respond",
          type: "RESPOND_TO_WEBHOOK",
          name: "Respond",
          position: { x: 260, y: 0 },
          data: {
            statusCode: 200,
            contentType: "application/json",
            body: '{"echo":"{{webhook.body.action}}"}',
            headers: { "x-handled-by": "autoflow" },
          },
        },
      ],
      edges: [{ source: "trigger", target: "respond" }],
    };

    const { execution } = await runGraph(graph, {
      // The option AF-M9-01 owed: without it a webhook body cannot be
      // injected at all, and this suite could not exist.
      initialData: {
        webhook: {
          path: "hook",
          method: "POST",
          headers: {},
          query: {},
          body: { action: "ping" },
        },
      },
    });

    expect(execution.status).toBe(ExecutionStatus.SUCCESS);
    expect(execution.response).toEqual({
      statusCode: 200,
      contentType: "application/json",
      headers: { "x-handled-by": "autoflow" },
      body: '{"echo":"ping"}',
    });
  });

  it("leaves response NULL when no respond node runs", async () => {
    const graph: TemplateGraph = {
      nodes: [
        {
          id: "trigger",
          type: "WEBHOOK_TRIGGER",
          name: "Inbound",
          position: { x: 0, y: 0 },
          data: {},
        },
        {
          id: "set",
          type: "SET",
          name: "Set",
          position: { x: 260, y: 0 },
          data: { mappings: [{ key: "ok", value: "yes" }] },
        },
      ],
      edges: [{ source: "trigger", target: "set" }],
    };

    const { execution } = await runGraph(graph, {
      initialData: { webhook: { path: "hook", method: "POST", body: {} } },
    });

    expect(execution.status).toBe(ExecutionStatus.SUCCESS);
    // NULL is the signal the route uses to keep the legacy envelope, so this
    // must stay distinguishable from "responded with an empty body".
    expect(execution.response).toBeNull();
  });

  it("records only the branch that ran (a 404-composing branch)", async () => {
    const graph: TemplateGraph = {
      nodes: [
        {
          id: "trigger",
          type: "WEBHOOK_TRIGGER",
          name: "Inbound",
          position: { x: 0, y: 0 },
          data: {},
        },
        {
          id: "known",
          type: "CONDITION",
          name: "Known action?",
          position: { x: 260, y: 0 },
          data: {
            left: "{{webhook.body.action}}",
            operator: "equals",
            right: "ping",
          },
        },
        {
          id: "ok",
          type: "RESPOND_TO_WEBHOOK",
          name: "OK",
          position: { x: 520, y: -80 },
          data: { statusCode: 200, body: '{"ok":true}' },
        },
        {
          id: "missing",
          type: "RESPOND_TO_WEBHOOK",
          name: "Not found",
          position: { x: 520, y: 80 },
          data: { statusCode: 404, body: '{"error":"unknown action"}' },
        },
      ],
      edges: [
        { source: "trigger", target: "known" },
        { source: "known", target: "ok", sourceHandle: "true" },
        { source: "known", target: "missing", sourceHandle: "false" },
      ],
    };

    const { execution } = await runGraph(graph, {
      initialData: {
        webhook: { path: "hook", method: "POST", body: { action: "nope" } },
      },
    });

    expect(execution.status).toBe(ExecutionStatus.SUCCESS);
    expect((execution.response as { statusCode: number }).statusCode).toBe(404);
    expect((execution.response as { body: string }).body).toBe(
      '{"error":"unknown action"}',
    );
  });
});

describe.skipIf(!hasDb)(
  "AF-M9-10 · route returns the composed response",
  () => {
    beforeEach(async () => {
      await prisma.nodeExecution.deleteMany({});
      await prisma.execution.deleteMany({});
      vi.clearAllMocks();
    });

    it("returns status, content type, headers and body verbatim", async () => {
      const { workflowId, secret } = await seedWorkflow();
      settleWith(ExecutionStatus.SUCCESS, {
        statusCode: 201,
        contentType: "text/plain",
        headers: { "x-trace": "abc123", "Cache-Control": "no-store" },
        body: "created",
      });

      const res = await call(workflowId, `?sync=true&secret=${secret}`);

      expect(res.status).toBe(201);
      expect(res.headers.get("content-type")).toBe("text/plain");
      expect(res.headers.get("x-trace")).toBe("abc123");
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.text()).toBe("created");
    });

    it("keeps the legacy envelope when no respond node ran", async () => {
      const { workflowId, secret } = await seedWorkflow();
      settleWith(ExecutionStatus.SUCCESS, null);

      const res = await call(workflowId, `?sync=true&secret=${secret}`);

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        success: boolean;
        executionId: string;
      };
      expect(body.success).toBe(true);
      expect(body.executionId).toBeTruthy();
    });

    it("returns the composed response even when the run FAILED", async () => {
      // "Respond early, then do slow work that later broke" must still give the
      // caller what it was promised — the reason the write is eager.
      const { workflowId, secret } = await seedWorkflow();
      settleWith(ExecutionStatus.FAILED, {
        statusCode: 202,
        contentType: "application/json",
        headers: {},
        body: '{"accepted":true}',
      });

      const res = await call(workflowId, `?sync=true&secret=${secret}`);

      expect(res.status).toBe(202);
      expect(await res.text()).toBe('{"accepted":true}');
    });

    it("strips a forbidden header that reached the row", async () => {
      // Defence in depth: the node already refuses these at compose time. This
      // is the second filter, for a row written by anything else.
      const { workflowId, secret } = await seedWorkflow();
      settleWith(ExecutionStatus.SUCCESS, {
        statusCode: 200,
        contentType: "application/json",
        headers: { "Set-Cookie": "session=hijacked", "x-ok": "kept" },
        body: "{}",
      });

      const res = await call(workflowId, `?sync=true&secret=${secret}`);

      expect(res.headers.get("set-cookie")).toBeNull();
      expect(res.headers.get("x-ok")).toBe("kept");
    });

    it("fails closed on an oversized stored body rather than serving it", async () => {
      const { workflowId, secret } = await seedWorkflow();
      settleWith(ExecutionStatus.SUCCESS, {
        statusCode: 200,
        contentType: "text/plain",
        headers: {},
        body: "x".repeat(1_000_001),
      });

      const res = await call(workflowId, `?sync=true&secret=${secret}`);

      expect(res.status).toBe(500);
    });

    it("ignores a malformed stored response and uses the envelope", async () => {
      const { workflowId, secret } = await seedWorkflow();
      settleWith(ExecutionStatus.SUCCESS, { statusCode: "not-a-number" });

      const res = await call(workflowId, `?sync=true&secret=${secret}`);

      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ success: true });
    });

    it("accepts GET, PUT, PATCH and DELETE, surfacing the method to the graph", async () => {
      const { workflowId, secret } = await seedWorkflow();

      for (const method of ["GET", "PUT", "PATCH", "DELETE"] as const) {
        settleWith(ExecutionStatus.SUCCESS, null);
        const res = await call(workflowId, `?secret=${secret}`, {
          method,
          // GET/DELETE must carry no body or `fetch` semantics reject the init.
          ...(method === "GET" || method === "DELETE"
            ? { body: undefined }
            : { body: JSON.stringify({ v: 1 }) }),
        });

        expect(res.status, method).toBe(202);

        const call0 = (
          sendWorkflowExecution as unknown as ReturnType<typeof vi.fn>
        ).mock.calls[0][0] as { initialData: { webhook: { method: string } } };
        expect(call0.initialData.webhook.method, method).toBe(method);
      }
    });

    it("sends a null body for GET, not an empty string", async () => {
      // `{{#if webhook.body}}` must be false for a bodyless request.
      const { workflowId, secret } = await seedWorkflow();
      settleWith(ExecutionStatus.SUCCESS, null);

      await call(workflowId, `?secret=${secret}`, {
        method: "GET",
        body: undefined,
      });

      const call0 = (
        sendWorkflowExecution as unknown as ReturnType<typeof vi.fn>
      ).mock.calls[0][0] as { initialData: { webhook: { body: unknown } } };
      expect(call0.initialData.webhook.body).toBeNull();
    });
  },
);
