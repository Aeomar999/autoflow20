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
  /** A Stripe customer id, e.g. `cus_123`. */
  customerId: freeText(256).optional(),
});

export const definition: NodeDefinition = {
  type: "STRIPE_GET_CUSTOMER",
  version: 1,
  category: "DATA",
  label: "Stripe Get Customer",
  description:
    "Read a customer by id, including their metadata and default payment method. A deleted customer is reported rather than treated as missing.",
  icon: "User",
  logo: "/logos/stripe.svg",
  keywords: ["stripe", "customer", "get", "read", "billing", "lookup"],
  configSchema,
  defaults: {},
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  credentials: [{ key: "credentialId", type: "stripe.apiKey", required: true }],
  docsUrl: "/docs/nodes/STRIPE_GET_CUSTOMER",
};
