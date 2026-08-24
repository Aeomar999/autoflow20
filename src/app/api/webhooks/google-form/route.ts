import { type NextRequest, NextResponse } from "next/server";
import { sendWorkflowExecution } from "@/inngest/utils";
import prisma from "@/lib/db";
import { logger } from "@/lib/logger";
import { secureCompare } from "@/lib/secure-compare";

export async function POST(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const workflowId = url.searchParams.get("workflowId");
    const secret = url.searchParams.get("secret");

    if (!workflowId || !secret) {
      return NextResponse.json(
        {
          success: false,
          error: "Missing required query parameters: workflowId, secret",
        },
        { status: 400 },
      );
    }

    // Ownership proof (audit S2): Google Forms cannot sign requests, so the
    // per-workflow URL secret is the only credential.
    const workflow = await prisma.workflow.findUnique({
      where: { id: workflowId },
      select: { id: true, webhookSecret: true },
    });
    if (!workflow || !secureCompare(secret, workflow.webhookSecret)) {
      logger.warn(
        "Google Form webhook rejected: unknown workflow or bad secret",
        {
          workflowId,
        },
      );
      return NextResponse.json(
        { success: false, error: "Not found" },
        { status: 404 },
      );
    }

    const body = await request.json();

    const formData = {
      formId: body.formId,
      formTitle: body.formTitle,
      responseId: body.responseId,
      timestamp: body.timestamp,
      respondentEmail: body.respondentEmail,
      responses: body.responses,
      raw: body,
    };

    await sendWorkflowExecution({
      workflowId,
      initialData: {
        googleForm: formData,
      },
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    logger.error("Google form webhook error", { error });
    return NextResponse.json(
      { success: false, error: "Failed to process Google Form submission" },
      { status: 500 },
    );
  }
}
