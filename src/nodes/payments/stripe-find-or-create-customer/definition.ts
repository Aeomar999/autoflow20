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
  name: freeText(256).optional(),
  phone: freeText(64).optional(),
  /** JSON object stored on the customer. Useful for your own ids. */
  metadata: freeText(8192).optional(),
});

export const definition: NodeDefinition = {
  type: "STRIPE_FIND_OR_CREATE_CUSTOMER",
  version: 1,
  category: "ACTION",
  label: "Stripe Find or Create Customer",
  description:
    "Look a customer up by email and create one only if there is none. Stripe allows duplicate emails, so this is the node that stops a billing account collecting four copies of the same person.",
  icon: "UserPlus",
  logo: "/logos/stripe.svg",
  keywords: ["stripe", "customer", "create", "billing", "find", "upsert"],
  configSchema,
  defaults: {},
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  credentials: [{ key: "credentialId", type: "stripe.apiKey", required: true }],
  docsUrl: "/docs/nodes/STRIPE_FIND_OR_CREATE_CUSTOMER",
};
