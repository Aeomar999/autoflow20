import { z } from "zod";
import type { NodeDefinition } from "@/nodes/types";
import {
  credentialIdRef,
  freeText,
  variableNameSchema,
} from "../../shared/config-fields";

export const configSchema = z.object({
  variableName: variableNameSchema.optional(),
  credentialId: credentialIdRef(),
  email: freeText(320).optional(),
  /** JSON array: [{ "title": "Widget", "quantity": 1, "price": "9.99" }]. */
  lineItems: freeText(65_536).optional(),
  /** JSON object for the shipping address. */
  shippingAddress: freeText(8192).optional(),
  /** Comma-separated tags. */
  tags: freeText(1024).optional(),
  note: freeText(5000).optional(),
  /** Email the customer Shopify's order confirmation. */
  sendReceipt: z.boolean().optional(),
});

export const definition: NodeDefinition = {
  type: "SHOPIFY_CREATE_ORDER",
  version: 1,
  category: "ACTION",
  label: "Shopify Create Order",
  description:
    "Create an order with line items, customer and shipping. A retried step returns the order it already created rather than billing the customer twice.",
  icon: "ShoppingCart",
  logo: "/logos/shopify.png",
  keywords: ["shopify", "order", "create", "commerce", "checkout", "sale"],
  configSchema,
  defaults: { sendReceipt: false },
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  credentials: [
    { key: "credentialId", type: "shopify.accessToken", required: true },
  ],
  docsUrl: "/docs/nodes/SHOPIFY_CREATE_ORDER",
};
