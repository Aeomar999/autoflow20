import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/inngest/client", () => ({
  inngest: { send: vi.fn(async () => ({ ids: ["evt_approval"] })) },
}));

import {
  approvalLinks,
  signApprovalToken,
} from "@/features/approvals/server/approval-token";
import { respondViaLink } from "@/features/approvals/server/respond";
import { inngest } from "@/inngest/client";
import prisma from "@/lib/db";

/**
 * AF-M10-09's link path against a real Postgres.
 *
 * The properties that need a database rather than a mock: that a replayed
 * token really is refused by the row's own state, that the refusal is
 * recorded, and that a decision resumes the run exactly once.
 */

const hasDb = Boolean(process.env.TEST_DATABASE_URL);

describe.runIf(hasDb)("approval links (AF-M10-09)", () => {
  let orgA: string;
  let orgB: string;
  let workflowId: string;
  let executionId: string;
  let approvalId: string;

  const tokenFor = (
    decision: "APPROVED" | "REJECTED",
    over: { approvalId?: string; organizationId?: string; exp?: number } = {},
  ) =>
    signApprovalToken({
      approvalId: over.approvalId ?? approvalId,
      organizationId: over.organizationId ?? orgA,
      decision,
      exp: over.exp ?? Math.floor(Date.now() / 1000) + 3600,
    });

  const auditFor = (action: string) =>
    prisma.auditLog.findFirst({
      where: { action, resourceId: approvalId },
      orderBy: { createdAt: "desc" },
    });

  beforeEach(async () => {
    vi.mocked(inngest.send).mockClear();
    process.env.CREDENTIAL_MASTER_KEY = "12345678901234567890123456789012";

    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE "approval_request","audit_log","organization","member","invitation","workspace","WorkflowVersion","NodeExecution","Execution","Connection","Node","Workflow","Credential","user","session","account","verification" CASCADE`,
    );

    await prisma.user.create({
      data: {
        id: "user_appr",
        email: "appr@test.local",
        name: "Approver",
        emailVerified: true,
      },
    });

    const a = await prisma.organization.create({
      data: {
        name: "Org A",
        slug: "appr-a",
        members: { create: { userId: "user_appr", role: "OWNER" } },
      },
    });
    const b = await prisma.organization.create({
      data: {
        name: "Org B",
        slug: "appr-b",
        members: { create: { userId: "user_appr", role: "OWNER" } },
      },
    });
    orgA = a.id;
    orgB = b.id;

    const workflow = await prisma.workflow.create({
      data: {
        name: "Contract gate",
        userId: "user_appr",
        organizationId: orgA,
      },
    });
    workflowId = workflow.id;

    const execution = await prisma.execution.create({
      data: {
        workflowId,
        organizationId: orgA,
        status: "RUNNING",
        inngestEventId: "evt_appr_run",
      },
    });
    executionId = execution.id;

    const approval = await prisma.approvalRequest.create({
      data: {
        organizationId: orgA,
        workflowId,
        executionId,
        nodeId: "approval-node",
        nodeName: "gate",
        prompt: "Approve the £40,000 contract?",
        timeoutAt: new Date(Date.now() + 3600_000),
      },
    });
    approvalId = approval.id;
  });

  it("approves once and resumes the run", async () => {
    const outcome = await respondViaLink({ token: tokenFor("APPROVED") });

    expect(outcome).toMatchObject({ ok: true, decision: "APPROVED" });

    const row = await prisma.approvalRequest.findUniqueOrThrow({
      where: { id: approvalId },
    });
    expect(row.status).toBe("APPROVED");
    expect(row.respondedAt).not.toBeNull();

    // Matched on the approval id, so a workflow holding two approvals is not
    // resumed twice by one answer.
    expect(inngest.send).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "workflow.approval.responded",
        data: expect.objectContaining({ approvalId, executionId }),
      }),
    );
  });

  it("rejects a replayed token and records it", async () => {
    // The acceptance. Single-use is enforced by the row's own state, so the
    // same link cannot be clicked twice — from a forwarded email or otherwise.
    const token = tokenFor("APPROVED");
    expect(await respondViaLink({ token })).toMatchObject({ ok: true });

    vi.mocked(inngest.send).mockClear();
    const replay = await respondViaLink({ token });

    expect(replay).toMatchObject({ ok: false, status: 409 });
    expect(inngest.send).not.toHaveBeenCalled();

    const audited = await auditFor("approval.link_replayed");
    expect(audited).not.toBeNull();
    expect(audited?.organizationId).toBe(orgA);
  });

  it("refuses the opposite decision after one was recorded", async () => {
    // Answering makes EVERY token for the request inert, not just the one that
    // was used — otherwise "approve" then "reject" would flip a settled run.
    await respondViaLink({ token: tokenFor("APPROVED") });
    const flip = await respondViaLink({ token: tokenFor("REJECTED") });

    expect(flip).toMatchObject({ ok: false, status: 409 });
    expect(
      (
        await prisma.approvalRequest.findUniqueOrThrow({
          where: { id: approvalId },
        })
      ).status,
    ).toBe("APPROVED");
  });

  it("refuses a token minted for another organization, and audits it", async () => {
    const outcome = await respondViaLink({
      token: tokenFor("APPROVED", { organizationId: orgB }),
    });

    expect(outcome).toMatchObject({ ok: false, status: 403 });
    // Audited against the REQUEST's org — the tenant whose data was aimed at.
    const audited = await auditFor("approval.link_rejected_cross_tenant");
    expect(audited?.organizationId).toBe(orgA);

    expect(
      (
        await prisma.approvalRequest.findUniqueOrThrow({
          where: { id: approvalId },
        })
      ).status,
    ).toBe("PENDING");
  });

  it("records the decision, identity and timestamp in AuditLog", async () => {
    await respondViaLink({
      token: tokenFor("REJECTED"),
      actorId: "user_appr",
      comment: "Terms are unacceptable.",
    });

    const audited = await auditFor("approval.rejected");
    expect(audited).not.toBeNull();
    expect(audited?.actorId).toBe("user_appr");
    expect(audited?.createdAt).toBeInstanceOf(Date);
    expect(audited?.after).toMatchObject({
      status: "REJECTED",
      comment: "Terms are unacceptable.",
      via: "link",
    });
  });

  it("refuses an expired link without resolving the request", async () => {
    const outcome = await respondViaLink({
      token: tokenFor("APPROVED", {
        exp: Math.floor(Date.now() / 1000) - 60,
      }),
    });
    expect(outcome).toMatchObject({ ok: false, status: 400 });
    expect(
      (
        await prisma.approvalRequest.findUniqueOrThrow({
          where: { id: approvalId },
        })
      ).status,
    ).toBe("PENDING");
  });

  it("times out a request whose deadline passed, rather than approving it", async () => {
    await prisma.approvalRequest.update({
      where: { id: approvalId },
      data: { timeoutAt: new Date(Date.now() - 1000) },
    });

    const outcome = await respondViaLink({ token: tokenFor("APPROVED") });
    expect(outcome).toMatchObject({ ok: false, status: 410 });
    expect(
      (
        await prisma.approvalRequest.findUniqueOrThrow({
          where: { id: approvalId },
        })
      ).status,
    ).toBe("TIMED_OUT");
    expect(inngest.send).not.toHaveBeenCalled();
  });

  it("404s for a token naming a request that no longer exists", async () => {
    const outcome = await respondViaLink({
      token: tokenFor("APPROVED", { approvalId: "appr_gone" }),
    });
    expect(outcome).toMatchObject({ ok: false, status: 404 });
  });

  it("shares one model with the dashboard list, not a parallel one", async () => {
    // The node writes the same `approval_request` row the dashboard reads, so
    // an approval raised by a graph appears in the same list.
    const links = approvalLinks({
      approvalId,
      organizationId: orgA,
      expiresAt: new Date(Date.now() + 3600_000),
      appUrl: "https://app.example.com",
    });
    expect(links.approve).toContain("/approvals/respond");

    const visible = await prisma.approvalRequest.findMany({
      where: { organizationId: orgA, status: "PENDING" },
    });
    expect(visible.map((row) => row.id)).toContain(approvalId);
  });
});
