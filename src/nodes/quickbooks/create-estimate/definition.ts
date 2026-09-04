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
  /** ISO date. Invoices only — an estimate has no due date. */
  dueDate: freeText(32).optional(),
  /** Leave blank to let QuickBooks assign the next number. */
  docNumber: freeText(64).optional(),
  customerMemo: freeText(4000).optional(),
});

export const definition: NodeDefinition = {
  type: "QBO_CREATE_ESTIMATE",
  version: 1,
  category: "ACTION",
  label: "QuickBooks Create Estimate",
  description:
    "Raise a QuickBooks estimate (quote) for a customer. Same line shape as an invoice; nothing posts to the ledger until it is accepted.",
  icon: "FileSpreadsheet",
  logo: QBO_LOGO,
  keywords: ["quickbooks", "qbo", "estimate", "quote", "accounting"],
  configSchema,
  defaults: {},
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  credentials: [
    { key: "credentialId", type: QBO_CREDENTIAL_TYPE, required: true },
  ],
  docsUrl: "/docs/nodes/QBO_CREATE_ESTIMATE",
};
