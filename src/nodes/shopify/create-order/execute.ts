import "server-only";
import { NonRetriableError } from "inngest";
import {
  createShopifyOrder,
  type ShopifyLineItem,
} from "@/features/shopify/server/shopify-client";
import { idempotencyKey } from "@/lib/server/idempotency";
import type { NodeRun } from "@/nodes/types";

type ShopifyOrderData = {
  variableName?: string;
  credentialId?: string;
  email?: string;
  lineItems?: string;
  shippingAddress?: string;
  tags?: string;
  note?: string;
  sendReceipt?: boolean;
};

export const execute: NodeRun<ShopifyOrderData> = async ({
  data,
  nodeId,
  executionId,
  context,
  resolve,
  step,
  credentials,
}) =>
  step.run("shopify-create-order", async () => {
    if (!data.variableName) {
      throw new NonRetriableError(
        "Shopify Create Order node: Variable name not configured",
      );
    }
    if (!data.lineItems) {
      throw new NonRetriableError(
        "Shopify Create Order node: Line items not configured",
      );
    }

    const where = "Shopify Create Order node";

    let lineItems: ShopifyLineItem[];
    try {
      const parsed = JSON.parse(resolve(data.lineItems));
      if (!Array.isArray(parsed)) throw new Error("not an array");
      lineItems = parsed as ShopifyLineItem[];
    } catch {
      throw new NonRetriableError(
        `${where}: the line items expression did not resolve to a JSON array. Use three braces — {{{json cart.items}}} — rather than two, which HTML-escapes the quotes.`,
      );
    }

    if (lineItems.length === 0) {
      // Shopify accepts an empty order and creates a £0 record nobody wants.
      throw new NonRetriableError(
        `${where}: the order has no line items. Shopify would accept that and create an empty order.`,
      );
    }

    let shippingAddress: Record<string, unknown> | undefined;
    if (data.shippingAddress) {
      const rendered = resolve(data.shippingAddress).trim();
      if (rendered.length > 0) {
        try {
          shippingAddress = JSON.parse(rendered) as Record<string, unknown>;
        } catch {
          throw new NonRetriableError(
            `${where}: the shipping address did not resolve to a JSON object.`,
          );
        }
      }
    }

    // Stable across retries of this step, distinct across runs. Shopify treats
    // source_name + source_identifier as unique per shop, so this is what
    // stops a retry creating a second order.
    const sourceIdentifier = idempotencyKey({ executionId, nodeId });

    const { order, created } = await createShopifyOrder({
      secret: credentials?.credentialId,
      sourceIdentifier,
      order: {
        line_items: lineItems,
        ...(data.email ? { email: resolve(data.email).trim() } : {}),
        ...(shippingAddress ? { shipping_address: shippingAddress } : {}),
        ...(data.tags ? { tags: resolve(data.tags).trim() } : {}),
        ...(data.note ? { note: resolve(data.note) } : {}),
        // Off by default: a workflow that silently emails customers the first
        // time it is switched on is a bad surprise.
        send_receipt: data.sendReceipt ?? false,
        financial_status: "pending",
      },
      where,
    });

    return {
      ...context,
      [data.variableName]: {
        id: order.id,
        name: order.name ?? null,
        orderNumber: order.order_number ?? null,
        totalPrice: order.total_price ?? null,
        currency: order.currency ?? null,
        financialStatus: order.financial_status ?? null,
        statusUrl: order.order_status_url ?? null,
        // False when the retry returned the order this step already made.
        created,
      },
    };
  });
