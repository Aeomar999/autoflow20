import { type NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { sendWorkflowExecution } from "@/inngest/utils";
import prisma from "@/lib/db";
import { logger } from "@/lib/logger";
import { secureCompare } from "@/lib/secure-compare";

let stripeClient: Stripe | null = null;

const getStripeClient = (): Stripe | null => {
  const signingSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signingSecret) {
    return null;
  }
  if (!stripeClient) {
    stripeClient = new Stripe(signingSecret);
  }
  return stripeClient;
};

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

    // Ownership proof: the URL secret must match the workflow's stored token.
    const workflow = await prisma.workflow.findUnique({
      where: { id: workflowId },
      select: { id: true, webhookSecret: true },
    });
    if (!workflow || !secureCompare(secret, workflow.webhookSecret)) {
      logger.warn("Stripe webhook rejected: unknown workflow or bad secret", {
        workflowId,
      });
      return NextResponse.json(
        { success: false, error: "Not found" },
        { status: 404 },
      );
    }

    // Signature verification (audit S1): reject anything not signed by our
    // configured Stripe endpoint. The raw body text is required.
    const stripe = getStripeClient();
    const signature = request.headers.get("stripe-signature");
    if (!stripe || !signature) {
      logger.error("Stripe webhook misconfigured: missing signing secret", {
        hasSignatureHeader: Boolean(signature),
      });
      return NextResponse.json(
        { success: false, error: "Stripe webhook is not configured" },
        { status: 500 },
      );
    }

    const rawBody = await request.text();
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(
        rawBody,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET as string,
      );
    } catch (error) {
      logger.warn("Stripe webhook signature verification failed", {
        reason: error instanceof Error ? error.message : "unknown",
      });
      return NextResponse.json(
        { success: false, error: "Invalid signature" },
        { status: 400 },
      );
    }

    const stripeData = {
      eventId: event.id,
      eventType: event.type,
      timestamp: event.created,
      livemode: event.livemode,
      raw: event.data.object,
    };

    await sendWorkflowExecution({
      workflowId,
      initialData: {
        stripe: stripeData,
      },
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    logger.error("Stripe webhook error", { error });
    return NextResponse.json(
      { success: false, error: "Failed to process Stripe event" },
      { status: 500 },
    );
  }
}
