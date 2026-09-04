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
  invoiceId: freeText(64).optional(),
  /** Defaults to Invoice-<DocNumber>.pdf when the invoice has one. */
  filename: freeText(255).optional(),
});

export const definition: NodeDefinition = {
  type: "QBO_GET_INVOICE_PDF",
  version: 1,
  category: "DATA",
  label: "QuickBooks Invoice PDF",
  description:
    "Fetch a QuickBooks invoice as the PDF QuickBooks itself would email, and store it as a file reference for a later upload or attachment.",
  icon: "FileDown",
  logo: QBO_LOGO,
  keywords: ["quickbooks", "qbo", "invoice", "pdf", "download", "accounting"],
  configSchema,
  defaults: {},
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  credentials: [
    { key: "credentialId", type: QBO_CREDENTIAL_TYPE, required: true },
  ],
  docsUrl: "/docs/nodes/QBO_GET_INVOICE_PDF",
};
