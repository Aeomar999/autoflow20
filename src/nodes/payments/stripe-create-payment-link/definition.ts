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
  /** An existing Stripe price id, e.g. `price_123`. */
  priceId: freeText(256).optional(),
  quantity: z.number().int().min(1).max(999).optional(),
  /** Where Stripe sends the buyer after paying. */
  successUrl: freeText(2048).optional(),
  metadata: freeText(8192).optional(),
});

export const definition: NodeDefinition = {
  type: "STRIPE_CREATE_PAYMENT_LINK",
  version: 1,
  category: "ACTION",
  label: "Stripe Create Payment Link",
  description:
    "Create a shareable payment link for an existing price. A retried step returns the link it already made rather than a second one.",
  icon: "Link",
  logo: "/logos/stripe.svg",
  keywords: ["stripe", "payment", "link", "checkout", "invoice", "pay"],
  configSchema,
  defaults: { quantity: 1 },
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  credentials: [{ key: "credentialId", type: "stripe.apiKey", required: true }],
  docsUrl: "/docs/nodes/STRIPE_CREATE_PAYMENT_LINK",
};
