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
  /** Bank or credit-card account the money left. */
  paymentAccountId: freeText(64).optional(),
  paymentType: z.enum(["Cash", "Check", "CreditCard"]).optional(),
  /** Expense account the cost is booked to. */
  expenseAccountId: freeText(64).optional(),
  amount: freeText(64).optional(),
  vendorId: freeText(64).optional(),
  /** ISO date. Defaults to today in the company's time zone. */
  txnDate: freeText(32).optional(),
  description: freeText(4000).optional(),
});

export const definition: NodeDefinition = {
  type: "QBO_CREATE_EXPENSE",
  version: 1,
  category: "ACTION",
  label: "QuickBooks Create Expense",
  description:
    "Record a QuickBooks expense. QuickBooks calls this a Purchase in its API and an Expense on screen; the account ids come from the company's chart of accounts.",
  icon: "CreditCard",
  logo: QBO_LOGO,
  keywords: ["quickbooks", "qbo", "expense", "purchase", "spend", "accounting"],
  configSchema,
  defaults: { paymentType: "CreditCard" },
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  credentials: [
    { key: "credentialId", type: QBO_CREDENTIAL_TYPE, required: true },
  ],
  docsUrl: "/docs/nodes/QBO_CREATE_EXPENSE",
};
