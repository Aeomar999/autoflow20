import "server-only";
import { inngest } from "@/inngest/client";
import { logAuditEvent } from "@/lib/audit";
import prisma from "@/lib/db";
import { ApprovalTokenError, verifyApprovalToken } from "./approval-token";

/**
 * Recording an approval decision (AF-M10-09).
 *
 * The single place a decision is written, whichever surface it arrived from —
 * the dashboard's tRPC mutation or an emailed link. Two implementations of
 * "resolve an approval" would eventually disagree about what counts as
 * already-answered, and the disagreement would be a double-resolve.
 */

export type ApprovalOutcome =
  | { ok: true; decision: "APPROVED" | "REJECTED"; approvalId: string }
  | { ok: false; reason: string; status?: number };

export interface RespondViaLinkArgs {
  token: string;
  /** Who clicked, when they happen to be signed in. Recorded, never required. */
  actorId?: string;
  comment?: string;
  ip?: string;
  userAgent?: string;
}

/**
 * Resolve an approval from an emailed link.
 *
 * Every rejection path is audited, including the ones that look like noise: a
 * replayed token and a token for another org are exactly what an attack looks
 * like from the inside, and a security event nobody recorded is a security
 * event nobody can investigate.
 */
export async function respondViaLink(
  args: RespondViaLinkArgs,
): Promise<ApprovalOutcome> {
  let payload: ReturnType<typeof verifyApprovalToken>;
  try {
    payload = verifyApprovalToken(args.token);
  } catch (error) {
    return {
      ok: false,
      reason:
        error instanceof ApprovalTokenError
          ? error.message
          : "This approval link is not valid.",
      status: 400,
    };
  }

  const request = await prisma.approvalRequest.findUnique({
    where: { id: payload.approvalId },
  });

  if (!request) {
    return { ok: false, reason: "This request no longer exists.", status: 404 };
  }

  // The token names its tenant and the row names its own; a mismatch means the
  // token was minted for a different organization. Audited against the
  // REQUEST's org, because that is the tenant whose data was aimed at.
  if (request.organizationId !== payload.organizationId) {
    await logAuditEvent({
      organizationId: request.organizationId,
      actorId: args.actorId,
      actorType: "SYSTEM",
      action: "approval.link_rejected_cross_tenant",
      resourceType: "approval_request",
      resourceId: request.id,
      after: { tokenOrganizationId: payload.organizationId },
      ip: args.ip,
      userAgent: args.userAgent,
    });
    return {
      ok: false,
      reason: "This approval link is not valid.",
      status: 403,
    };
  }

  if (request.status !== "PENDING") {
    // Single-use, enforced by the row's own state rather than a separate flag:
    // answering the request makes every token for it inert, so the two cannot
    // disagree. A replay is expected after a forwarded email and is still
    // worth recording.
    await logAuditEvent({
      organizationId: request.organizationId,
      actorId: args.actorId,
      actorType: args.actorId ? "USER" : "SYSTEM",
      action: "approval.link_replayed",
      resourceType: "approval_request",
      resourceId: request.id,
      after: { alreadyStatus: request.status, attempted: payload.decision },
      ip: args.ip,
      userAgent: args.userAgent,
    });
    return {
      ok: false,
      reason: `This request was already ${request.status.toLowerCase()}.`,
      status: 409,
    };
  }

  if (request.timeoutAt < new Date()) {
    await prisma.approvalRequest.update({
      where: { id: request.id },
      data: { status: "TIMED_OUT" },
    });
    return {
      ok: false,
      reason: "This request timed out before it was answered.",
      status: 410,
    };
  }

  // Conditional update: `status: "PENDING"` in the WHERE is what makes two
  // simultaneous clicks resolve once. Without it, both reads see PENDING and
  // both writes succeed, and the run is resumed twice.
  const { count } = await prisma.approvalRequest.updateMany({
    where: { id: request.id, status: "PENDING" },
    data: {
      status: payload.decision,
      comment: args.comment,
      respondedById: args.actorId ?? null,
      respondedAt: new Date(),
    },
  });

  if (count === 0) {
    return {
      ok: false,
      reason: "This request was answered a moment ago.",
      status: 409,
    };
  }

  await inngest.send({
    name: "workflow.approval.responded",
    data: {
      approvalId: request.id,
      executionId: request.executionId,
      status: payload.decision,
      comment: args.comment,
      userId: args.actorId,
    },
  });

  await logAuditEvent({
    organizationId: request.organizationId,
    actorId: args.actorId,
    actorType: args.actorId ? "USER" : "SYSTEM",
    action: `approval.${payload.decision.toLowerCase()}`,
    resourceType: "approval_request",
    resourceId: request.id,
    after: {
      status: payload.decision,
      comment: args.comment,
      via: "link",
    },
    ip: args.ip,
    userAgent: args.userAgent,
  });

  return { ok: true, decision: payload.decision, approvalId: request.id };
}

/** Read-only view for the confirmation page, without resolving anything. */
export async function previewApprovalToken(token: string): Promise<
  | {
      ok: true;
      approvalId: string;
      decision: "APPROVED" | "REJECTED";
      prompt: string | null;
      nodeName: string;
      workflowName: string;
      alreadyResolved: boolean;
    }
  | { ok: false; reason: string }
> {
  let payload: ReturnType<typeof verifyApprovalToken>;
  try {
    payload = verifyApprovalToken(token);
  } catch (error) {
    return {
      ok: false,
      reason:
        error instanceof ApprovalTokenError
          ? error.message
          : "This approval link is not valid.",
    };
  }

  const request = await prisma.approvalRequest.findUnique({
    where: { id: payload.approvalId },
    include: { workflow: { select: { name: true } } },
  });

  if (!request || request.organizationId !== payload.organizationId) {
    return { ok: false, reason: "This approval link is not valid." };
  }

  return {
    ok: true,
    approvalId: request.id,
    decision: payload.decision,
    prompt: request.prompt,
    nodeName: request.nodeName,
    workflowName: request.workflow.name,
    alreadyResolved: request.status !== "PENDING",
  };
}
