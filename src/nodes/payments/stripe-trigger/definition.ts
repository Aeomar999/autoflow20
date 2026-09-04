import type { NodeDefinition } from "@/nodes/types";
import { triggerDataSchema } from "../../shared/config-fields";

export const configSchema = triggerDataSchema;

export const definition: NodeDefinition = {
  type: "STRIPE_TRIGGER",
  version: 1,
  category: "TRIGGER",
  label: "Stripe Trigger",
  description:
    "Start the workflow when a signed Stripe webhook event arrives for this workflow.",
  icon: "CreditCard",
  logo: "/logos/stripe.svg",
  keywords: ["stripe", "payment", "webhook", "checkout", "billing"],
  configSchema,
  defaults: {},
  inputs: [],
  outputs: [{ id: "main", label: "Out" }],
};
