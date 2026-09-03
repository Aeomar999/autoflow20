import { beforeEach, describe, expect, it, vi } from "vitest";
import { workflowsRouter } from "@/features/workflows/server/routers";
import type { Prisma } from "@/generated/prisma/client";
import { collectScheduledDispatches } from "@/inngest/cron";
import { sendWorkflowExecution } from "@/inngest/utils";
import prisma from "@/lib/db";
import type { createTRPCContext } from "@/trpc/init";

/**
 * AF-M9-17 — a disabled trigger must never dispatch a run.
 *
 * All three dispatch paths are exercised against a real Postgres and assert
 * that **no** `Execution` row is created: a webhook POST 404s before the
 * rate-limiter consume and before any enqueue, `workflows.run` refuses up
 * front, and the cron evaluator returns an empty dispatch list for a workflow
 * whose schedule trigger is disabled. An enabled-trigger control guards each
 * path so the disabled check cannot silently swallow legitimate runs.
 */
const dbUrl = process.env.TEST_DATABASE_URL;
const hasDb = Boolean(dbUrl);

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: vi
        .fn()
        .mockResolvedValue({ user: { id: "user_dt" }, session: {} }),
    },
  },
}));
vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Map()),
}));
vi.mock("@/inngest/utils", () => ({
  sendWorkflowExecution: vi.fn().mockResolvedValue({ eventId: "evt_dt" }),
}));

const { POST: webhookPost } = await import(
  "@/app/api/webhooks/[workflowId]/[path]/route"
);

const makeRequest = (url: string, body: string) => {
  return new Request(url, {
    method: "POST",
    body,
    headers: { "content-type": "application/json" },
  }) as never;
};

const webhookTrigger = (disabled: boolean) => ({
  nodes: [
    {
      id: "t1",
      type: "WEBHOOK_TRIGGER",
      name: "Webhook",
      data: {},
      disabled,
    },
  ],
  edges: [],
});

const scheduleTrigger = (disabled: boolean) => ({
  nodes: [
    {
      id: "t1",
      type: "SCHEDULE_TRIGGER",
      name: "Schedule",
      data: { cron: "* * * * *", timezone: "UTC" },
      disabled,
    },
  ],
  edges: [],
});

describe.runIf(hasDb)("disabled trigger does not dispatch (AF-M9-17)", () => {
  const user = {
    id: "user_dt",
    email: "dt@test.local",
    name: "DT User",
    emailVerified: true,
  };
  const mockCtx = {} as unknown as ReturnType<typeof createTRPCContext>;
  const caller = workflowsRouter.createCaller(mockCtx);

  let wfId: string;
  let wfSecret: string;

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE "organization","member","invitation","workspace","WorkflowVersion","NodeExecution","Execution","Connection","Node","Workflow","Credential","user","session","account","verification" CASCADE`,
    );
    vi.mocked(sendWorkflowExecution).mockClear();

    await prisma.user.create({ data: user });
    const org = await prisma.organization.create({
      data: {
        name: "DT Workspace",
        slug: "disabled-trigger-integration",
        members: { create: { userId: user.id, role: "OWNER" } },
      },
    });
    const wf = await prisma.workflow.create({
      data: {
        name: "Disabled Trigger WF",
        userId: user.id,
        organizationId: org.id,
      },
      select: { id: true, webhookSecret: true },
    });
    wfId = wf.id;
    wfSecret = wf.webhookSecret;
  });

  const publishSnapshot = async (snapshot: unknown) => {
    const version = await prisma.workflowVersion.create({
      data: {
        workflowId: wfId,
        version: 1,
        workflowRevision: 0,
        graphSnapshot: snapshot as unknown as Prisma.InputJsonValue,
      },
    });
    await prisma.workflow.update({
      where: { id: wfId },
      data: { activeVersionId: version.id },
    });
    return version;
  };

  const executionCount = () =>
    prisma.execution.count({ where: { workflowId: wfId } });

  const fetchActiveWorkflows = () =>
    prisma.workflow.findMany({
      where: { id: wfId },
      select: {
        id: true,
        activeVersion: { select: { graphSnapshot: true } },
      },
    }) as unknown as Promise<
      Array<{ id: string; activeVersion: { graphSnapshot: unknown } | null }>
    >;

  describe("webhook route", () => {
    it("does not 404 for an enabled webhook trigger (control)", async () => {
      await publishSnapshot(webhookTrigger(false));

      const res = await webhookPost(
        makeRequest(
          `http://localhost/api/webhooks/${wfId}/anything?secret=${wfSecret}`,
          "{}",
        ),
        { params: Promise.resolve({ workflowId: wfId, path: "anything" }) },
      );
      expect(res.status).not.toBe(404);
    });

    it("returns generic 404 for a disabled webhook trigger with no Execution row", async () => {
      await publishSnapshot(webhookTrigger(true));

      const res = await webhookPost(
        makeRequest(
          `http://localhost/api/webhooks/${wfId}/my-path?secret=${wfSecret}`,
          "{}",
        ),
        { params: Promise.resolve({ workflowId: wfId, path: "my-path" }) },
      );

      expect(res.status).toBe(404);
      const body = (await res.json()) as { error?: string };
      expect(body.error).toBe("Not found");
      expect(vi.mocked(sendWorkflowExecution)).not.toHaveBeenCalled();
      expect(await executionCount()).toBe(0);
    });
  });

  describe("cron evaluator", () => {
    it("returns an empty dispatch list for a disabled schedule trigger (no Execution row)", async () => {
      await publishSnapshot(scheduleTrigger(true));

      const workflows = await fetchActiveWorkflows();
      const dispatches = collectScheduledDispatches(workflows, new Date());

      expect(dispatches).toHaveLength(0);
      expect(vi.mocked(sendWorkflowExecution)).not.toHaveBeenCalled();
      expect(await executionCount()).toBe(0);
    });

    it("dispatches for an enabled matching schedule trigger (control)", async () => {
      await publishSnapshot(scheduleTrigger(false));

      const workflows = await fetchActiveWorkflows();
      const dispatches = collectScheduledDispatches(workflows, new Date());

      expect(dispatches).toHaveLength(1);
      expect(dispatches[0].workflowId).toBe(wfId);
    });
  });

  describe("workflows.run", () => {
    it("refuses when the draft's only trigger is disabled, naming it, with no Execution row", async () => {
      await prisma.node.create({
        data: {
          workflowId: wfId,
          type: "WEBHOOK_TRIGGER",
          name: "Inbound Webhook",
          position: { x: 0, y: 0 },
          disabled: true,
        },
      });

      await expect(caller.run({ id: wfId })).rejects.toThrow(
        /only trigger, "Inbound Webhook", is disabled/i,
      );
      expect(vi.mocked(sendWorkflowExecution)).not.toHaveBeenCalled();
      expect(await executionCount()).toBe(0);
    });

    it("runs when the draft's only trigger is enabled (control)", async () => {
      await prisma.node.create({
        data: {
          workflowId: wfId,
          type: "WEBHOOK_TRIGGER",
          name: "Inbound Webhook",
          position: { x: 0, y: 0 },
          disabled: false,
        },
      });

      const result = await caller.run({ id: wfId });
      expect(result.id).toBeTruthy();
      expect(await executionCount()).toBe(1);
    });
  });
});
