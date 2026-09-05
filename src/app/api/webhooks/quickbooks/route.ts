import { type NextRequest, NextResponse } from "next/server";
import {
  collectQboTargets,
  credentialIdsForRealm,
  MAX_EVENTS_PER_NOTIFICATION,
  qboTriggerContext,
} from "@/features/quickbooks/server/dispatch";
import {
  parseIntuitNotification,
  verifyIntuitSignature,
} from "@/features/quickbooks/server/webhook";
import { sendWorkflowExecution } from "@/inngest/utils";
import prisma from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * Intuit's app-wide webhook endpoint (AF-M10-16).
 *
 * One URL for every connected company, so the shape is different from the
 * Stripe and Google Form routes: there is no per-workflow secret in the URL,
 * the signature is the only proof, and routing happens after verification by
 * matching the payload's realm to a stored credential.
 *
 * Intuit retries on a non-2xx and disables an endpoint that keeps failing, so
 * this answers 200 as soon as the payload is verified and accepted. A workflow
 * that then fails is an execution failure, visible in the run list, and not a
 * reason to make Intuit resend the notification.
 */

/** Bodies larger than this are not Intuit notifications. */
const MAX_BODY_BYTES = 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    const verifierToken = process.env.INTUIT_WEBHOOK_VERIFIER_TOKEN;
    if (!verifierToken) {
      // A misconfiguration, not a client error — and it must not be reported
      // as a signature failure, which would send someone hunting for the
      // wrong bug.
      logger.error(
        "QuickBooks webhook misconfigured: INTUIT_WEBHOOK_VERIFIER_TOKEN is not set",
      );
      return NextResponse.json(
        { success: false, error: "QuickBooks webhooks are not configured" },
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
    const signature = request.headers.get("intuit-signature");
    if (!verifyIntuitSignature({ rawBody, signature, verifierToken })) {
      logger.warn(
        "QuickBooks webhook rejected: signature verification failed",
        {
          hasSignatureHeader: Boolean(signature),
          bytes: rawBody.length,
        },
      );
      // Deliberately NOT written to `AuditLog`. That table is org-scoped and
      // read through an org-scoped viewer, and an unverified payload has no
      // proven realm — so every rejection would have to be filed against a
      // guessed tenant, in the one table whose value depends on its rows being
      // true. Rejections are operator-facing, not tenant-facing, so the
      // structured warning above is the record.
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

    const realms = parseIntuitNotification(body);
    if (realms.length === 0) {
      // Intuit sends an empty notification as a keep-alive. Signed and valid,
      // just nothing to do — a 200 with no dispatch, not an error.
      return NextResponse.json({ success: true, dispatched: 0 });
    }

    let dispatched = 0;

    for (const realm of realms) {
      const credentials = await credentialIdsForRealm(realm.realmId);
      if (credentials.length === 0) {
        // A company someone connected and then disconnected, or one connected
        // to a different deployment sharing the Intuit app. Not an error.
        logger.info("QuickBooks webhook: no credential for realm", {
          realmId: realm.realmId,
        });
        continue;
      }

      const organizationIds = [
        ...new Set(credentials.map((c) => c.organizationId)),
      ];
      const workflows = await prisma.workflow.findMany({
        // "Published", the same predicate the schedule sweep uses: a draft has
        // no active version and must not run from a webhook.
        where: {
          organizationId: { in: organizationIds },
          activeVersionId: { not: null },
        },
        select: {
          id: true,
          organizationId: true,
          activeVersion: { select: { graphSnapshot: true } },
        },
      });

      const targets = collectQboTargets({
        workflows: workflows.flatMap((workflow) =>
          workflow.organizationId
            ? [{ ...workflow, organizationId: workflow.organizationId }]
            : [],
        ),
        credentialIds: new Set(credentials.map((c) => c.id)),
        realm,
      });

      for (const target of targets) {
        for (const event of target.events) {
          // One run per entity event: an invoice and a payment in the same
          // notification are two unrelated things, and a graph handed a list
          // would have to loop for the common case of one record changing.
          await sendWorkflowExecution({
            workflowId: target.workflowId,
            organizationId: target.organizationId,
            initialData: qboTriggerContext({
              realmId: realm.realmId,
              event,
            }),
          });
          dispatched += 1;
        }

        if (target.events.length >= MAX_EVENTS_PER_NOTIFICATION) {
          logger.warn(
            "QuickBooks webhook: notification hit the per-run event cap",
            {
              workflowId: target.workflowId,
              realmId: realm.realmId,
              cap: MAX_EVENTS_PER_NOTIFICATION,
            },
          );
        }
      }
    }

    return NextResponse.json({ success: true, dispatched });
  } catch (error) {
    logger.error("QuickBooks webhook error", { error });
    return NextResponse.json(
      { success: false, error: "Failed to process QuickBooks notification" },
      { status: 500 },
    );
  }
}
