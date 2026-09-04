import { type NextRequest, NextResponse } from "next/server";
import { parseWahaEvent } from "@/features/waha/server/waha-client";
import { sendWorkflowExecution } from "@/inngest/utils";
import prisma from "@/lib/db";
import { logger } from "@/lib/logger";
import { secureCompare } from "@/lib/secure-compare";

/**
 * WAHA's per-workflow webhook endpoint (AF-M10-21).
 *
 * WAHA is self-hosted and sends whatever headers its operator configures, so
 * like Telegram there is no signature — the shared secret is the whole proof,
 * and it is the workflow's own. Accepted from `X-Api-Key` or a query
 * parameter, because WAHA's webhook config supports custom headers in some
 * versions and only a URL in others.
 */

/**
 * A WhatsApp message event. Media arrives as a URL rather than bytes, so even
 * a photo event is small.
 */
const MAX_BODY_BYTES = 1024 * 1024;

type SnapshotNode = {
  id?: string;
  type?: string;
  disabled?: boolean;
  data?: Record<string, unknown>;
};

function findWahaTrigger(graphSnapshot: unknown): SnapshotNode | null {
  try {
    const snapshot =
      typeof graphSnapshot === "string"
        ? (JSON.parse(graphSnapshot) as { nodes?: SnapshotNode[] })
        : (graphSnapshot as { nodes?: SnapshotNode[] } | null);
    return (
      snapshot?.nodes?.find(
        (node) => node?.type === "WAHA_TRIGGER" && node.disabled !== true,
      ) ?? null
    );
  } catch {
    return null;
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> },
) {
  const { workflowId } = await params;

  try {
    const workflow = await prisma.workflow.findUnique({
      where: { id: workflowId },
      select: {
        id: true,
        organizationId: true,
        webhookSecret: true,
        activeVersionId: true,
        activeVersion: { select: { graphSnapshot: true } },
      },
    });

    if (
      !workflow?.activeVersionId ||
      !workflow.organizationId ||
      !workflow.webhookSecret
    ) {
      return NextResponse.json({ ok: false }, { status: 404 });
    }

    const provided =
      request.headers.get("x-api-key") ??
      new URL(request.url).searchParams.get("secret");

    // Before the body is read, for the same reason as the Telegram route.
    if (!provided || !secureCompare(provided, workflow.webhookSecret)) {
      logger.warn("WAHA webhook rejected: bad or missing secret", {
        workflowId,
      });
      return NextResponse.json({ ok: false }, { status: 404 });
    }

    const rawBody = await request.text();
    if (rawBody.length > MAX_BODY_BYTES) {
      return NextResponse.json({ ok: false }, { status: 413 });
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ ok: false }, { status: 400 });
    }

    const message = parseWahaEvent(body);
    if (!message) {
      return NextResponse.json({ ok: true, dispatched: 0 });
    }

    // THE important filter. WAHA delivers the bot's own outbound messages back
    // as events, so a workflow that replies to what it receives would reply to
    // its own replies — forever, at WhatsApp's expense and the recipient's.
    if (message.fromMe) {
      return NextResponse.json({ ok: true, dispatched: 0, echo: true });
    }

    const trigger = findWahaTrigger(workflow.activeVersion?.graphSnapshot);
    if (!trigger) {
      logger.warn("WAHA webhook: workflow has no enabled WAHA trigger", {
        workflowId,
      });
      return NextResponse.json({ ok: true, dispatched: 0 });
    }

    const allowed =
      typeof trigger.data?.allowedChatIds === "string"
        ? trigger.data.allowedChatIds
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean)
        : [];

    if (
      allowed.length > 0 &&
      (!message.chatId || !allowed.includes(message.chatId))
    ) {
      return NextResponse.json({ ok: true, dispatched: 0 });
    }

    await sendWorkflowExecution({
      workflowId: workflow.id,
      organizationId: workflow.organizationId,
      initialData: {
        whatsapp: {
          messageId: message.messageId,
          chatId: message.chatId,
          from: message.from,
          text: message.text,
          hasMedia: message.hasMedia,
          timestamp: message.timestamp,
          payload: body,
        },
      },
    });

    return NextResponse.json({ ok: true, dispatched: 1 });
  } catch (error) {
    logger.error("WAHA webhook error", { error, workflowId });
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
