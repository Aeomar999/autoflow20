import { z } from "zod";
import type { NodeDefinition } from "@/nodes/types";
import {
  credentialIdRef,
  freeText,
  variableNameSchema,
} from "../../shared/config-fields";
import { QBO_CREDENTIAL_TYPE, QBO_LOGO } from "../shared";

export const configSchema = z.object({
  variableName: variableNameSchema.optional(),
  credentialId: credentialIdRef(),
  /** QBO customer id, usually from a Find or Create Customer node. */
  customerId: freeText(64).optional(),
  /**
   * JSON array of lines: { amount, description?, quantity?, unitPrice?, itemId? }.
   * Authored as a triple-brace expression — {{{json order.items}}} — because a
   * key/value panel cannot express a list of objects.
   */
  lines: freeText(64_000).optional(),
  /** Overrides the customer's address on the document only. */
  email: freeText(320).optional(),
  /** Account the money landed in. Defaults to the company's Undeposited Funds. */
  depositToAccountId: freeText(64).optional(),
  /** Leave blank to let QuickBooks assign the next number. */
  docNumber: freeText(64).optional(),
  customerMemo: freeText(4000).optional(),
});

export const definition: NodeDefinition = {
  type: "QBO_CREATE_SALES_RECEIPT",
  version: 1,
  category: "ACTION",
  label: "QuickBooks Create Sales Receipt",
  description:
    "Record a QuickBooks sales receipt for money already taken — a Stripe charge, a card payment. Unlike an invoice this is paid on creation, so it needs no follow-up.",
  icon: "Receipt",
  logo: QBO_LOGO,
  keywords: ["quickbooks", "qbo", "receipt", "payment", "stripe", "accounting"],
  configSchema,
  defaults: {},
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  credentials: [
    { key: "credentialId", type: QBO_CREDENTIAL_TYPE, required: true },
  ],
  docsUrl: "/docs/nodes/QBO_CREATE_SALES_RECEIPT",
};
