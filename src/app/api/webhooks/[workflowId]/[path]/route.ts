import { type NextRequest, NextResponse } from "next/server";
import { MAX_WEBHOOK_RESPONSE_BYTES } from "@/inngest/trace";
import { sendWorkflowExecution } from "@/inngest/utils";
import prisma from "@/lib/db";
import { logger } from "@/lib/logger";
import { memoryRateLimiter, resolvePlanBucket } from "@/lib/rate-limit";
import { secureCompare } from "@/lib/secure-compare";
import {
  filterResponseHeaders,
  isValidResponseStatus,
} from "@/lib/webhook-response";

/**
 * Whether the active version's webhook trigger is disabled (AF-M9-17).
 * The published `graphSnapshot` records `disabled: n.disabled ?? false` for
 * every node (see `workflows.publish`), so a disabled WEBHOOK_TRIGGER is
 * visible here without touching the engine. Returns true when any webhook
 * trigger in the snapshot is explicitly disabled; a malformed snapshot is
 * treated as not-disabled so a parse problem never becomes a silent 404.
 */
function hasDisabledWebhookTrigger(graphSnapshot: unknown): boolean {
  if (graphSnapshot === null || graphSnapshot === undefined) return false;
  let parsed: { nodes?: unknown };
  try {
    parsed =
      typeof graphSnapshot === "string"
        ? (JSON.parse(graphSnapshot) as { nodes?: unknown })
        : (graphSnapshot as { nodes?: unknown });
  } catch {
    return false;
  }
  const nodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
  return nodes.some(
    (n) =>
      typeof n === "object" &&
      n !== null &&
      (n as { type?: unknown }).type === "WEBHOOK_TRIGGER" &&
      (n as { disabled?: unknown }).disabled === true,
  );
}

/**
 * Return the response a RESPOND_TO_WEBHOOK node composed (AF-M9-10).
 *
 * `Execution.response` is NULL for every run that never reached a respond
 * node, which is the signal to keep the pre-M9 `{success, executionId, error}`
 * envelope — returning `null` here means "no composed response", not "an empty
 * one".
 *
 * Headers are filtered a second time here, even though the node already
 * filtered them at compose time. The stored value is data read back from the
 * database: re-filtering costs nothing and means a row written by an older
 * build, a migration, or anything other than the current node code still
 * cannot emit `Set-Cookie` or split a response.
 */
function composedResponseFrom(stored: unknown): NextResponse | null {
  if (!stored || typeof stored !== "object") return null;

  const rec = stored as Record<string, unknown>;
  const statusCode = rec.statusCode;
  const body = rec.body;
  if (typeof statusCode !== "number" || typeof body !== "string") return null;
  if (!isValidResponseStatus(statusCode)) return null;

  const bodyBytes = Buffer.byteLength(body, "utf8");
  if (bodyBytes > MAX_WEBHOOK_RESPONSE_BYTES) {
    logger.error("Webhook response exceeded size cap", { bodyBytes });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }

  const { headers } = filterResponseHeaders(
    rec.headers && typeof rec.headers === "object"
      ? (rec.headers as Record<string, string>)
      : {},
  );

  const contentType =
    typeof rec.contentType === "string" && rec.contentType.length > 0
      ? rec.contentType
      : "application/json";

  return new NextResponse(body, {
    status: statusCode,
    headers: { ...headers, "Content-Type": contentType },
  });
}

async function handleWebhook(
  request: NextRequest,
  { params }: { params: Promise<{ workflowId: string; path: string }> },
) {
  try {
    const { workflowId, path } = await params;
    const url = new URL(request.url);

    const workflow = await prisma.workflow.findUnique({
      where: { id: workflowId },
      select: {
        id: true,
        userId: true,
        organizationId: true,
        webhookSecret: true,
        activeVersionId: true,
        activeVersion: { select: { graphSnapshot: true } },
        organization: { select: { plan: true } },
      },
    });

    if (!workflow) {
      // Generic 404 - never reveals workflow exists
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // AF-M9-17: a disabled webhook trigger must not dispatch a run. Checked
    // before the rate-limiter consume and before any `Execution` row is created
    // so a disabled trigger costs the org nothing and reveals nothing to a
    // prober — indistinguishable from the unknown-workflow 404 above.
    if (hasDisabledWebhookTrigger(workflow.activeVersion?.graphSnapshot)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Plan-aware token bucket per endpoint (security.md §8). Consumed only for
    // real workflows; unknown ids already returned 404 above.
    const decision = memoryRateLimiter.consume(
      `webhook:${workflowId}:${path}`,
      resolvePlanBucket(workflow.organization?.plan),
    );
    if (!decision.allowed) {
      return NextResponse.json(
        { error: "Too many requests" },
        {
          status: 429,
          headers: { "Retry-After": String(decision.retryAfterSeconds) },
        },
      );
    }

    if (!workflow.activeVersionId) {
      // Must have an active version to run
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Verify secret: query string, Bearer token, or x-webhook-secret
    const secretFromQuery = url.searchParams.get("secret");
    const secretFromHeader = request.headers.get("x-webhook-secret");
    const authHeader = request.headers.get("authorization");
    let secretFromBearer = null;
    if (authHeader?.toLowerCase().startsWith("bearer ")) {
      secretFromBearer = authHeader.substring(7);
    }

    const providedSecret =
      secretFromQuery || secretFromHeader || secretFromBearer;
    if (
      !providedSecret ||
      !secureCompare(providedSecret, workflow.webhookSecret)
    ) {
      logger.warn("Webhook rejected: missing or bad secret", {
        workflowId,
        path,
      });
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Raw payload capture. GET and DELETE carry no body by definition, so
    // `webhook.body` is null for them rather than the empty string an
    // unconditional `text()` would produce — `{{#if webhook.body}}` must not
    // be true for a bodyless request (AF-M9-10).
    const methodHasBody = !["GET", "DELETE", "HEAD"].includes(request.method);
    let parsedBody: unknown = null;
    if (methodHasBody) {
      const rawBody = await request.text();
      try {
        parsedBody = JSON.parse(rawBody);
      } catch {
        parsedBody = rawBody;
      }
    }

    const headersList = Object.fromEntries(request.headers.entries());

    const { createId } = await import("@paralleldrive/cuid2");
    const executionId = createId();
    const placeholderEventId = createId();

    // Pre-create the Execution row before emitting the event: the runner
    // resolves a pre-created execution when executionId is present
    // (AF-M2-06), and the workspace is needed for credential resolution.
    await prisma.execution.create({
      data: {
        id: executionId,
        workflowId,
        trigger: "WEBHOOK",
        mode: "PRODUCTION",
        status: "RUNNING",
        inngestEventId: placeholderEventId,
        organizationId: workflow.organizationId,
      },
    });

    // Pass the payload to the execution engine
    const { eventId } = await sendWorkflowExecution({
      workflowId,
      userId: workflow.userId,
      organizationId: workflow.organizationId ?? undefined,
      executionId,
      initialData: {
        webhook: {
          path,
          method: request.method,
          headers: headersList,
          query: Object.fromEntries(url.searchParams.entries()),
          body: parsedBody,
        },
      },
    });

    await prisma.execution.update({
      where: { id: executionId },
      data: { inngestEventId: eventId },
    });

    const isSync = url.searchParams.get("sync") === "true";
    if (isSync) {
      // Sync-respond with hard timeout (20s)
      const timeoutMs = 20000;
      const start = Date.now();

      while (Date.now() - start < timeoutMs) {
        const exec = await prisma.execution.findUnique({
          where: { id: executionId },
          select: { status: true, error: true, response: true },
        });

        if (exec && (exec.status === "SUCCESS" || exec.status === "FAILED")) {
          // AF-M9-10: a RESPOND_TO_WEBHOOK node's response wins over the
          // envelope — including on a FAILED run, because the node writes
          // eagerly and "respond, then do slow work that later broke" must
          // still return what the caller was promised.
          const composed = composedResponseFrom(exec.response);
          if (composed) {
            return composed;
          }

          // No respond node ran: the pre-M9 contract is preserved exactly.
          return NextResponse.json(
            {
              success: exec.status === "SUCCESS",
              executionId,
              error: exec.error,
            },
            { status: exec.status === "SUCCESS" ? 200 : 500 },
          );
        }

        // AF-M9-10 note: the 500 ms poll is KEPT deliberately. Replacing it
        // with an Inngest realtime subscription or Postgres LISTEN was the
        // task's preferred option, but both bind a long-lived connection to a
        // serverless request handler that Vercel may freeze between event-loop
        // turns — a correctness risk traded for latency this endpoint does not
        // need. Revisit if sync webhooks move to a long-lived runtime.
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      // Hard timeout
      return NextResponse.json({ error: "Gateway Timeout" }, { status: 504 });
    }

    return NextResponse.json({ success: true, executionId }, { status: 202 });
  } catch (error) {
    logger.error("Webhook processing error", { error });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * AF-M9-10: the endpoint accepts every method a real API endpoint is called
 * with, not just POST. The reference library's "sync API endpoint" workflows
 * (W1 and its generalizations, e.g. `Respondtowebhook/1466 Multi Methods API
 * Endpoint`) route on the method, which requires it to reach the graph — it
 * does, as `webhook.method`.
 *
 * HEAD and OPTIONS are deliberately absent. Both are protocol-level requests a
 * caller issues about the endpoint rather than to the workflow: answering them
 * by starting a run would burn quota on a CORS preflight.
 */
export const POST = handleWebhook;
export const GET = handleWebhook;
export const PUT = handleWebhook;
export const PATCH = handleWebhook;
export const DELETE = handleWebhook;
