import { type NextRequest, NextResponse } from "next/server";
import { sendWorkflowExecution } from "@/inngest/utils";
import prisma from "@/lib/db";
import { logger } from "@/lib/logger";
import { secureCompare } from "@/lib/secure-compare";

const RATE_LIMIT_WINDOW = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 60; // 60 req/min per endpoint
const rateLimits = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(key: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const record = rateLimits.get(key);

  if (!record || now >= record.resetAt) {
    rateLimits.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return { allowed: true };
  }

  if (record.count >= RATE_LIMIT_MAX_REQUESTS) {
    const retryAfter = Math.ceil((record.resetAt - now) / 1000);
    return { allowed: false, retryAfter };
  }

  record.count += 1;
  return { allowed: true };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workflowId: string; path: string }> }
) {
  try {
    const { workflowId, path } = await params;
    const url = new URL(request.url);

    // Rate Limit check
    const { allowed, retryAfter } = checkRateLimit(`webhook:${workflowId}:${path}`);
    if (!allowed) {
      return new NextResponse(JSON.stringify({ error: "Too many requests" }), {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(retryAfter),
        },
      });
    }

    const workflow = await prisma.workflow.findUnique({
      where: { id: workflowId },
      select: { id: true, webhookSecret: true, activeVersionId: true },
    });

    if (!workflow) {
      // Generic 404 - never reveals workflow exists
      return NextResponse.json({ error: "Not found" }, { status: 404 });
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
    if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
      secretFromBearer = authHeader.substring(7);
    }

    const providedSecret = secretFromQuery || secretFromHeader || secretFromBearer;
    if (!providedSecret || !secureCompare(providedSecret, workflow.webhookSecret)) {
      logger.warn("Webhook rejected: missing or bad secret", { workflowId, path });
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Raw payload capture
    const rawBody = await request.text();
    let parsedBody: any = null;
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      parsedBody = rawBody;
    }

    const headersList = Object.fromEntries(request.headers.entries());

    const { createId } = await import("@paralleldrive/cuid2");
    const executionId = createId();

    // Pass the payload to the execution engine
    await sendWorkflowExecution({
      workflowId,
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
              error: exec.error 
            },
            { status: exec.status === "SUCCESS" ? 200 : 500 }
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
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

