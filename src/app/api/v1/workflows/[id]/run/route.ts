import { createId } from "@paralleldrive/cuid2";
import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  handlePublicApi,
  PublicApiError,
} from "@/features/api-keys/server/public-api";
import { Prisma } from "@/generated/prisma/client";
import { sendWorkflowExecution } from "@/inngest/utils";
import prisma from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/workflows/:id/run — trigger a run (scope: workflows:execute).
 *
 * Honors an `Idempotency-Key` header: a retried run with the same key for the
 * same workflow returns the existing execution instead of creating another.
 * Concurrency is handled at the DB via the (workflowId, idempotencyKey) unique
 * index, so two simultaneous requests with the same key still produce one run.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return handlePublicApi(req, "workflows:execute", async (principal) => {
    const { id } = await params;

    const workflow = await prisma.workflow.findFirst({
      where: { id, organizationId: principal.organizationId },
      select: { id: true, organizationId: true },
    });
    if (!workflow) {
      throw new PublicApiError(404, "NOT_FOUND", "Workflow not found");
    }

    const idempotencyKey = normalizeIdempotencyKey(
      req.headers.get("idempotency-key"),
    );
    const body = await parseBody(req);

    if (idempotencyKey) {
      const existing = await prisma.execution.findFirst({
        where: { workflowId: workflow.id, idempotencyKey },
        select: { id: true },
      });
      if (existing) return { execution_id: existing.id };
    }

    const placeholderEventId = createId();
    let run: { id: string };
    try {
      run = await prisma.execution.create({
        data: {
          workflowId: workflow.id,
          trigger: "API",
          mode: "PRODUCTION",
          status: "RUNNING",
          inngestEventId: placeholderEventId,
          organizationId: workflow.organizationId ?? undefined,
          ...(idempotencyKey ? { idempotencyKey } : {}),
        },
        select: { id: true },
      });
    } catch (err) {
      // Concurrent duplicate with the same idempotency key collides on the
      // unique index; treat it as a successful replay, not a failure.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        const existing = await prisma.execution.findFirst({
          where: { workflowId: workflow.id, idempotencyKey },
          select: { id: true },
        });
        if (existing) return { execution_id: existing.id };
      }
      throw err;
    }

    const { eventId } = await sendWorkflowExecution({
      workflowId: workflow.id,
      executionId: run.id,
      organizationId: workflow.organizationId ?? undefined,
      initialData: body.input,
    });
    await prisma.execution.update({
      where: { id: run.id },
      data: { inngestEventId: eventId },
    });

    return { execution_id: run.id };
  });
}

const runBodySchema = z.object({
  /** Arbitrary JSON object injected into the run as its input payload. */
  input: z.record(z.string(), z.unknown()).optional(),
});

async function parseBody(
  req: NextRequest,
): Promise<{ input?: Record<string, unknown> }> {
  const raw = await req.text();
  if (!raw.trim()) return {};
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new PublicApiError(
      400,
      "BAD_REQUEST",
      "Request body must be valid JSON",
    );
  }
  const result = runBodySchema.safeParse(json);
  if (!result.success) {
    throw new PublicApiError(
      400,
      "BAD_REQUEST",
      "Invalid request body",
      result.error.flatten().fieldErrors,
    );
  }
  return result.data;
}

const IDEMPOTENCY_KEY_MAX = 128;

function normalizeIdempotencyKey(raw: string | null): string | null {
  const value = raw?.trim() ?? "";
  if (!value) return null;
  if (value.length > IDEMPOTENCY_KEY_MAX) {
    throw new PublicApiError(
      400,
      "BAD_REQUEST",
      "Idempotency-Key is too long (max 128 characters)",
    );
  }
  if (!/^[\x21-\x7E]+$/.test(value)) {
    throw new PublicApiError(
      400,
      "BAD_REQUEST",
      "Idempotency-Key may only contain printable ASCII characters",
    );
  }
  return value;
}
