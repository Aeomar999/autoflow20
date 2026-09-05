import { type NextRequest, NextResponse } from "next/server";
import {
  collectGithubTargets,
  githubTriggerContext,
} from "@/features/github/server/dispatch";
import {
  parseGithubDelivery,
  verifyGithubSignature,
} from "@/features/github/server/webhook";
import { sendWorkflowExecution } from "@/inngest/utils";
import prisma from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * GitHub's app-wide webhook endpoint (AF-M10-18).
 *
 * One URL for every connected repository, so this has the same shape as the
 * Intuit route rather than the per-workflow ones: there is no secret in the
 * URL, the signature is the only proof, and routing happens after verification
 * by matching the payload's repository to a published trigger.
 *
 * GitHub disables a webhook that keeps failing, so this answers 200 as soon as
 * the delivery is verified and accepted. A workflow that then fails is an
 * execution failure, visible in the run list, and not a reason to make GitHub
 * redeliver.
 */

/** Bodies larger than this are not GitHub deliveries. */
const MAX_BODY_BYTES = 5 * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    if (!secret) {
      // A misconfiguration, not a client error — and it must not be reported
      // as a signature failure, which would send someone after the wrong bug.
      logger.error(
        "GitHub webhook misconfigured: GITHUB_WEBHOOK_SECRET is not set",
      );
      return NextResponse.json(
        { success: false, error: "GitHub webhooks are not configured" },
        { status: 500 },
      );
    }

    const rawBody = await request.text();
    if (rawBody.length > MAX_BODY_BYTES) {
      return NextResponse.json(
        { success: false, error: "Payload too large" },
        { status: 413 },
      );
    }

    // Verified against the RAW body. Parsing and re-serialising produces a
    // byte-for-byte different document and every check would fail.
    const signature = request.headers.get("x-hub-signature-256");
    if (!verifyGithubSignature({ rawBody, signature, secret })) {
      logger.warn("GitHub webhook rejected: signature verification failed", {
        hasSignatureHeader: Boolean(signature),
        bytes: rawBody.length,
      });
      // Not written to AuditLog, for the same reason as the Intuit route: an
      // unverified payload has no proven tenant, and filing it against a
      // guessed one would put false rows in the one table whose value depends
      // on its rows being true.
      return NextResponse.json(
        { success: false, error: "Invalid signature" },
        { status: 401 },
      );
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json(
        { success: false, error: "Body is not JSON" },
        { status: 400 },
      );
    }

    const delivery = parseGithubDelivery({ headers: request.headers, body });

    // GitHub sends a `ping` when a webhook is first configured. It is a valid,
    // signed delivery that no workflow subscribes to — a 200 confirms the hook
    // works, which is exactly what the sender is checking.
    if (delivery.event === "ping") {
      return NextResponse.json({ success: true, dispatched: 0, pong: true });
    }

    if (!delivery.repository) {
      // Organisation-level events carry no repository and cannot be routed.
      return NextResponse.json({ success: true, dispatched: 0 });
    }

    const workflows = await prisma.workflow.findMany({
      // "Published", the same predicate the schedule sweep uses: a draft has
      // no active version and must not run from a webhook.
      where: { activeVersionId: { not: null } },
      select: {
        id: true,
        organizationId: true,
        activeVersion: { select: { graphSnapshot: true } },
      },
    });

    const targets = collectGithubTargets({
      workflows: workflows.flatMap((workflow) =>
        workflow.organizationId
          ? [{ ...workflow, organizationId: workflow.organizationId }]
          : [],
      ),
      delivery,
    });

    for (const target of targets) {
      await sendWorkflowExecution({
        workflowId: target.workflowId,
        organizationId: target.organizationId,
        initialData: githubTriggerContext({ delivery, body }),
      });
    }

    return NextResponse.json({ success: true, dispatched: targets.length });
  } catch (error) {
    logger.error("GitHub webhook error", { error });
    return NextResponse.json(
      { success: false, error: "Failed to process GitHub delivery" },
      { status: 500 },
    );
  }
}
