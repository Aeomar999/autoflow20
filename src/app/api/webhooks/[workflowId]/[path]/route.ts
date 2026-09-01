import { type NextRequest, NextResponse } from "next/server";
import { sendWorkflowExecution } from "@/inngest/utils";
import prisma from "@/lib/db";
import { logger } from "@/lib/logger";
import { memoryRateLimiter, resolvePlanBucket } from "@/lib/rate-limit";
import { secureCompare } from "@/lib/secure-compare";

export async function POST(
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
        organization: { select: { plan: true } },
      },
    });

    if (!workflow) {
      // Generic 404 - never reveals workflow exists
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

    // Raw payload capture
    const rawBody = await request.text();
    let parsedBody: unknown = null;
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      parsedBody = rawBody;
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
          select: { status: true, error: true },
        });

        if (exec && (exec.status === "SUCCESS" || exec.status === "FAILED")) {
          return NextResponse.json(
            {
              success: exec.status === "SUCCESS",
              executionId,
              error: exec.error,
            },
            { status: exec.status === "SUCCESS" ? 200 : 500 },
          );
        }

        // Wait 500ms before checking again
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
