import "server-only";
import { NonRetriableError } from "inngest";
import nodemailer from "nodemailer";
import { approvalLinks } from "@/features/approvals/server/approval-token";
import { NodeExecutionStatus } from "@/generated/prisma/client";
import { OUTPUT_PORT_KEY } from "@/inngest/trace";
import prisma from "@/lib/db";
import { publicAppUrl } from "@/lib/env";
import type { NodeRun } from "@/nodes/types";
import { MAX_APPROVAL_SECONDS } from "./definition";

/**
 * `APPROVAL` — send and wait (AF-M10-09).
 *
 * Binds the graph to the `ApprovalRequest` model the dashboard already uses:
 * **one model, one list**. A node that kept its own table would give operators
 * two places to look and two definitions of "answered".
 *
 * The wait is `step.waitForEvent`, not a poll — the run holds nothing open
 * while it waits, and Inngest resumes it on the same event the dashboard's
 * `approvals.respond` mutation already emits.
 */

type ApprovalData = {
  variableName?: string;
  prompt?: string;
  channel?: "email" | "dashboard";
  approvers?: string;
  credentialId?: string;
  from?: string;
  subject?: string;
  timeoutSeconds?: number;
};

interface ResponseEvent {
  data?: {
    approvalId?: string;
    status?: string;
    comment?: string;
    userId?: string;
  };
}

export const execute: NodeRun<ApprovalData> = async ({
  data,
  nodeId,
  workflowId,
  executionId,
  organizationId,
  context,
  resolve,
  step,
  credentials,
}) => {
  if (!data.variableName) {
    throw new NonRetriableError("Approval node: Variable name not configured");
  }
  if (!workflowId || !executionId || !organizationId) {
    // The request row is keyed by all three. Without them the approval could
    // be created but never found by the dashboard, which is worse than not
    // creating it — a run blocked on something nobody can answer.
    throw new NonRetriableError(
      "Approval node: this run carries no workflow, execution or organization, so an approval request cannot be recorded.",
    );
  }

  const timeoutSeconds = Math.min(
    data.timeoutSeconds ?? 86_400,
    MAX_APPROVAL_SECONDS,
  );
  const prompt = data.prompt ? resolve(data.prompt) : "Approve this run?";

  // Created in its own step so a retry of the surrounding function does not
  // create a second request for the same node.
  const request = await step.run(`approval-create:${nodeId}`, async () => {
    const row = await prisma.approvalRequest.create({
      data: {
        organizationId,
        workflowId,
        executionId,
        nodeId,
        nodeName: data.variableName as string,
        prompt,
        timeoutAt: new Date(Date.now() + timeoutSeconds * 1000),
      },
    });
    return { id: row.id, timeoutAt: row.timeoutAt.toISOString() };
  });

  if (data.channel !== "dashboard") {
    await step.run(`approval-notify:${nodeId}`, async () => {
      await sendApprovalEmail({
        approvalId: request.id,
        organizationId,
        timeoutAt: new Date(request.timeoutAt),
        prompt,
        to: data.approvers ? resolve(data.approvers) : "",
        from: data.from,
        subject: data.subject ? resolve(data.subject) : "Approval needed",
        secret: credentials?.credentialId,
      });
      return true;
    });
  }

  // Distinct status while parked, so a run waiting a day does not read as
  // hung in the run list (AF-M10-08 added `WAITING` for exactly this).
  await step.run(`approval-mark-waiting:${nodeId}`, async () => {
    await prisma.nodeExecution.updateMany({
      where: { executionId, nodeId, status: NodeExecutionStatus.RUNNING },
      data: { status: NodeExecutionStatus.WAITING },
    });
    return true;
  });

  // Matched on the approval id, not the execution id: a workflow may hold two
  // approvals, and matching on the run would let the first answer resume both.
  const response = (await step.waitForEvent(`approval-wait:${nodeId}`, {
    event: "workflow.approval.responded",
    timeout: `${timeoutSeconds}s`,
    if: `async.data.approvalId == "${request.id}"`,
  })) as ResponseEvent | null;

  if (!response) {
    // A timeout is a decision, not a failure: the run continues down the
    // `rejected` branch with the reason recorded, rather than dying and
    // leaving whatever the approval was gating in an unknown state.
    await step.run(`approval-timeout:${nodeId}`, async () => {
      await prisma.approvalRequest.updateMany({
        where: { id: request.id, status: "PENDING" },
        data: { status: "TIMED_OUT" },
      });
      return true;
    });

    return {
      ...context,
      [OUTPUT_PORT_KEY]: "rejected",
      [data.variableName]: {
        approvalId: request.id,
        decision: "TIMED_OUT",
        approved: false,
        skipReason: `No answer within ${timeoutSeconds} seconds; routed to the rejected branch.`,
        respondedAt: null,
        respondedBy: null,
        comment: null,
      },
    };
  }

  const approved = response.data?.status === "APPROVED";

  return {
    ...context,
    [OUTPUT_PORT_KEY]: approved ? "approved" : "rejected",
    [data.variableName]: {
      approvalId: request.id,
      decision: approved ? "APPROVED" : "REJECTED",
      approved,
      comment: response.data?.comment ?? null,
      respondedBy: response.data?.userId ?? null,
      respondedAt: new Date().toISOString(),
      skipReason: null,
    },
  };
};

/**
 * Send the request, with both links.
 *
 * The links point at a confirmation page, not at an endpoint that acts on GET.
 * Mail scanners, link previewers and corporate security gateways all follow
 * links in email; an approval that resolved on GET would be approved by a
 * scanner before the human read it.
 */
async function sendApprovalEmail(args: {
  approvalId: string;
  organizationId: string;
  timeoutAt: Date;
  prompt: string;
  to: string;
  from?: string;
  subject: string;
  secret?: Record<string, string>;
}): Promise<void> {
  const recipients = args.to
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (recipients.length === 0) {
    throw new NonRetriableError(
      "Approval node: no approver addresses configured for the email channel.",
    );
  }
  if (!args.secret?.host || !args.secret.username || !args.secret.password) {
    throw new NonRetriableError(
      "Approval node: the email channel needs an SMTP credential bound to this node.",
    );
  }
  if (!args.from) {
    throw new NonRetriableError(
      "Approval node: the email channel needs a sender address.",
    );
  }

  const links = approvalLinks({
    approvalId: args.approvalId,
    organizationId: args.organizationId,
    expiresAt: args.timeoutAt,
    appUrl: publicAppUrl,
  });

  const tlsMode = args.secret.tls ?? "starttls";
  const transport = nodemailer.createTransport({
    host: args.secret.host,
    port: Number(args.secret.port ?? 587),
    secure: tlsMode === "ssl",
    requireTLS: tlsMode === "starttls",
    auth: { user: args.secret.username, pass: args.secret.password },
  });

  const deadline = args.timeoutAt.toISOString();

  await transport.sendMail({
    from: args.from,
    to: recipients.join(", "),
    subject: args.subject,
    text: [
      args.prompt,
      "",
      `Approve: ${links.approve}`,
      `Reject:  ${links.reject}`,
      "",
      `Both links expire at ${deadline}. Whichever you choose, you will be asked to confirm.`,
    ].join("\n"),
    html: [
      `<p>${escapeHtml(args.prompt)}</p>`,
      `<p><a href="${links.approve}">Approve</a> &nbsp;·&nbsp; <a href="${links.reject}">Reject</a></p>`,
      `<p style="color:#666;font-size:12px">Both links expire at ${escapeHtml(deadline)}. Whichever you choose, you will be asked to confirm.</p>`,
    ].join(""),
  });
}

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
