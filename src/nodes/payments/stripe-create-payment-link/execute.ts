import "server-only";
import { NonRetriableError } from "inngest";
import { stripeFetch } from "@/features/stripe/server/stripe-client";
import { idempotencyKey } from "@/lib/server/idempotency";
import type { NodeRun } from "@/nodes/types";

type PaymentLinkData = {
  variableName?: string;
  credentialId?: string;
  priceId?: string;
  quantity?: number;
  successUrl?: string;
  metadata?: string;
};

export const execute: NodeRun<PaymentLinkData> = async ({
  data,
  nodeId,
  executionId,
  context,
  resolve,
  step,
  credentials,
}) =>
  step.run("stripe-create-payment-link", async () => {
    if (!data.variableName) {
      throw new NonRetriableError(
        "Stripe Payment Link node: Variable name not configured",
      );
    }
    if (!data.priceId) {
      throw new NonRetriableError(
        "Stripe Payment Link node: Price not configured",
      );
    }

    const where = "Stripe Payment Link node";
    const priceId = resolve(data.priceId).trim();

    if (!priceId.startsWith("price_")) {
      // A product id (prod_) is the usual mix-up, and Stripe's own error for
      // it does not say which kind of id it wanted.
      throw new NonRetriableError(
        `${where}: "${priceId}" is not a price id. Payment links take a price (price_…), not a product (prod_…).`,
      );
    }

    let metadata: Record<string, string> | undefined;
    if (data.metadata) {
      const rendered = resolve(data.metadata).trim();
      if (rendered.length > 0) {
        try {
          const parsed = JSON.parse(rendered) as Record<string, unknown>;
          metadata = Object.fromEntries(
            Object.entries(parsed).map(([key, value]) => [key, String(value)]),
          );
        } catch {
          throw new NonRetriableError(
            `${where}: the metadata expression did not resolve to a JSON object.`,
          );
        }
      }
    }

    const link = await stripeFetch<{
      id: string;
      url?: string;
      active?: boolean;
    }>(credentials?.credentialId, {
      path: "/payment_links",
      method: "POST",
      body: {
        line_items: [{ price: priceId, quantity: data.quantity ?? 1 }],
        ...(metadata ? { metadata } : {}),
        ...(data.successUrl
          ? {
              after_completion: {
                type: "redirect",
                redirect: { url: resolve(data.successUrl).trim() },
              },
            }
          : {}),
      },
      idempotencyKey: idempotencyKey({ executionId, nodeId }),
      where,
    });

    return {
      ...context,
      [data.variableName]: {
        id: link.id,
        url: link.url ?? null,
        active: link.active ?? true,
        priceId,
        quantity: data.quantity ?? 1,
      },
    };
  });
