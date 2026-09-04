import { createId } from "@paralleldrive/cuid2";
import { type NextRequest, NextResponse } from "next/server";
import { storeFile } from "@/features/files/server/file-service";
import {
  ALLOWED_FORM_FILE_TYPES,
  coerceFieldValue,
  type FieldValidationError,
  MAX_FORM_FILE_BYTES,
  MAX_FORM_FILES,
  MAX_FORM_SUBMISSION_BYTES,
  validateFieldValue,
} from "@/features/forms/form-schema";
import { findPublishedForm } from "@/features/forms/server/form-lookup";
import { sendWorkflowExecution } from "@/inngest/utils";
import prisma from "@/lib/db";
import { logger } from "@/lib/logger";
import { memoryRateLimiter, resolvePlanBucket } from "@/lib/rate-limit";

/**
 * Public form submissions (AF-M10-14).
 *
 * Unauthenticated by design — the whole point is that a stranger can submit —
 * which makes every limit here load-bearing rather than defensive. The order
 * of the checks matters as much as the checks: nothing that costs the org
 * anything happens before the form is known to exist.
 */

export const runtime = "nodejs";

const notFound = () =>
  NextResponse.json({ error: "Not found" }, { status: 404 });

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> },
) {
  try {
    const { workflowId } = await params;
    const url = new URL(request.url);
    const pathSegment = url.searchParams.get("s") ?? undefined;

    const form = await findPublishedForm({ workflowId, pathSegment });
    // One 404 for "no such workflow", "not published", "no form", "disabled"
    // and "wrong path segment" — a prober must not be able to tell them apart.
    if (!form) {
      return notFound();
    }

    // Plan-aware bucket, consumed only once the form is known to exist, so an
    // unknown id cannot spend a real org's allowance.
    const decision = memoryRateLimiter.consume(
      `form:${workflowId}`,
      resolvePlanBucket(form.plan as never),
    );
    if (!decision.allowed) {
      return NextResponse.json(
        { error: "Too many submissions. Try again shortly." },
        {
          status: 429,
          headers: { "Retry-After": String(decision.retryAfterSeconds) },
        },
      );
    }

    // Declared size first: rejecting before reading is the difference between
    // refusing a 2 GB upload and buffering one.
    const declaredLength = Number.parseInt(
      request.headers.get("content-length") ?? "",
      10,
    );
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > MAX_FORM_SUBMISSION_BYTES
    ) {
      return NextResponse.json(
        { error: "Submission too large." },
        { status: 413 },
      );
    }

    let payload: FormData;
    try {
      payload = await request.formData();
    } catch {
      return NextResponse.json(
        { error: "Submission could not be read." },
        { status: 400 },
      );
    }

    const errors: FieldValidationError[] = [];
    const values: Record<string, unknown> = {};
    const files: Record<string, unknown> = {};
    let fileCount = 0;
    let totalBytes = 0;

    for (const field of form.fields) {
      if (field.type === "file") {
        const entry = payload.get(field.name);
        const file = entry instanceof File && entry.size > 0 ? entry : null;

        if (!file) {
          if (field.required) {
            errors.push({
              field: field.name,
              message: `${field.label} is required.`,
            });
          }
          continue;
        }

        fileCount += 1;
        if (fileCount > MAX_FORM_FILES) {
          errors.push({
            field: field.name,
            message: `At most ${MAX_FORM_FILES} files can be submitted at once.`,
          });
          continue;
        }

        if (file.size > MAX_FORM_FILE_BYTES) {
          errors.push({
            field: field.name,
            message: `${field.label} must be ${Math.round(MAX_FORM_FILE_BYTES / (1024 * 1024))} MB or smaller.`,
          });
          continue;
        }

        // Allowlist, not blocklist: this endpoint is reachable by anyone with
        // the link, and accepting arbitrary types means hosting arbitrary
        // content for strangers under our domain.
        const mimeType = (
          file.type || "application/octet-stream"
        ).toLowerCase();
        if (!ALLOWED_FORM_FILE_TYPES.has(mimeType)) {
          errors.push({
            field: field.name,
            message: `${field.label} must be a document or image (received ${mimeType}).`,
          });
          continue;
        }

        totalBytes += file.size;
        if (totalBytes > MAX_FORM_SUBMISSION_BYTES) {
          errors.push({
            field: field.name,
            message: "Submission too large.",
          });
          continue;
        }

        const bytes = Buffer.from(await file.arrayBuffer());
        // No executionId: the run does not exist yet, so the file carries an
        // explicit TTL and the sweep collects it if the run never happens
        // (ADR-0025).
        const ref = await storeFile({
          organizationId: form.organizationId,
          workflowId: form.workflowId,
          filename: file.name || `${field.name}.bin`,
          mimeType,
          data: bytes,
        });
        files[field.name] = ref;
        values[field.name] = ref;
        continue;
      }

      const raw = payload.get(field.name);
      const value = typeof raw === "string" ? raw : null;
      const problem = validateFieldValue(field, value);
      if (problem) {
        errors.push(problem);
        continue;
      }
      values[field.name] = coerceFieldValue(field, value);
    }

    if (errors.length > 0) {
      // Every problem at once. A form that surfaces errors one at a time is
      // how people give up on a form.
      return NextResponse.json({ errors }, { status: 400 });
    }

    const executionId = createId();
    const placeholderEventId = createId();

    await prisma.execution.create({
      data: {
        id: executionId,
        workflowId: form.workflowId,
        trigger: "FORM",
        mode: "PRODUCTION",
        status: "RUNNING",
        inngestEventId: placeholderEventId,
        organizationId: form.organizationId,
      },
    });

    const { eventId } = await sendWorkflowExecution({
      workflowId: form.workflowId,
      userId: form.userId,
      organizationId: form.organizationId,
      executionId,
      initialData: {
        // Mirrors the AF-M9-07 `webhook.*` shape so a ported expression
        // resolves: metadata at the top, the payload under `fields`.
        form: {
          nodeId: form.nodeId,
          title: form.title,
          submittedAt: new Date().toISOString(),
          fields: values,
          files,
        },
      },
    });

    await prisma.execution.update({
      where: { id: executionId },
      data: { inngestEventId: eventId },
    });

    return NextResponse.json(
      { success: true, message: form.successMessage },
      { status: 202 },
    );
  } catch (error) {
    logger.error("Form submission failed", { error });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
