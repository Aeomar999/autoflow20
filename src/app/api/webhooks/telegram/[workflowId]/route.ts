import { type NextRequest, NextResponse } from "next/server";
import {
  matchTelegramTrigger,
  telegramTriggerContext,
} from "@/features/telegram/server/dispatch";
import {
  parseTelegramUpdate,
  verifyTelegramSecret,
} from "@/features/telegram/server/webhook";
import { sendWorkflowExecution } from "@/inngest/utils";
import prisma from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * Telegram's per-workflow webhook endpoint (AF-M10-21).
 *
 * One endpoint per workflow, not per app — forced by how Telegram works. A bot
 * has exactly one webhook URL, and the only shared secret it will echo is the
 * `secret_token` set alongside that URL, so the workflow must be identifiable
 * from the path.
 *
 * **Telegram does not sign its deliveries.** There is no HMAC to verify; the
 * `X-Telegram-Bot-Api-Secret-Token` header is the whole proof. That is weaker
 * than the GitHub and Intuit routes by construction, so: the secret is the
 * workflow's own (never deployment-wide), the comparison is constant-time, and
 * an update that fails it is dropped without starting a run.
 *
 * Telegram retries a delivery until it gets a 2xx and will disable a webhook
 * that keeps failing, so this answers 200 as soon as the update is accepted. A
 * workflow that then fails is an execution failure, visible in the run list.
 */

/**
 * Telegram updates are small — a text message is a few hundred bytes, and the
 * largest realistic one is a long caption. Anything at this size is not an
 * update, and reading it would be the point at which an unauthenticated
 * request could cost memory.
 */
const MAX_BODY_BYTES = 1024 * 1024;

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

    // One 404 for every reason a delivery cannot run: unknown workflow,
    // unpublished, no org. Telling them apart would turn this into an oracle
    // for which workflow ids exist.
    if (
      !workflow?.activeVersionId ||
      !workflow.organizationId ||
      !workflow.webhookSecret
    ) {
      return NextResponse.json({ ok: false }, { status: 404 });
    }

    // BEFORE the body is read: an unauthenticated request must not be able to
    // make this process allocate.
    const provided = request.headers.get("x-telegram-bot-api-secret-token");
    if (!verifyTelegramSecret({ provided, expected: workflow.webhookSecret })) {
      logger.warn("Telegram webhook rejected: bad or missing secret token", {
        workflowId,
        hasHeader: Boolean(provided),
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

    const update = parseTelegramUpdate(body);
    if (!update) {
      // Verified, but not shaped like an update. A 200 stops Telegram
      // retrying something that will never parse.
      logger.warn("Telegram webhook: verified payload was not an update", {
        workflowId,
      });
      return NextResponse.json({ ok: true, dispatched: 0 });
    }

    const match = matchTelegramTrigger({
      graphSnapshot: workflow.activeVersion?.graphSnapshot,
      update,
      workflowId,
    });

    if (!match) {
      logger.warn(
        "Telegram webhook: workflow has no enabled Telegram trigger",
        {
          workflowId,
        },
      );
      return NextResponse.json({ ok: true, dispatched: 0 });
    }

    if (!match.matched) {
      // A filter excluded it. Normal, and not worth a warning.
      return NextResponse.json({ ok: true, dispatched: 0 });
    }

    await sendWorkflowExecution({
      workflowId: workflow.id,
      organizationId: workflow.organizationId,
      initialData: telegramTriggerContext({ update, body }),
    });

    return NextResponse.json({ ok: true, dispatched: 1 });
  } catch (error) {
    logger.error("Telegram webhook error", { error, workflowId });
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
