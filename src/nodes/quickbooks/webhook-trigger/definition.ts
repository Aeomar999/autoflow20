import { z } from "zod";
import { QBO_ENTITY_NAMES } from "@/features/quickbooks/entity-names";
import type { NodeDefinition } from "@/nodes/types";
import { credentialIdRef } from "../../shared/config-fields";
import { QBO_CREDENTIAL_TYPE, QBO_LOGO } from "../shared";

export const configSchema = z.object({
  /**
   * Which connection's company to listen for.
   *
   * Intuit posts every connected company's events to one app-wide endpoint,
   * so the credential is how a workflow says which company it means. Without
   * it a second connected company's invoices would start this workflow too.
   */
  credentialId: credentialIdRef(),
  /** Empty means every type. Narrow it — "anything changed" fires constantly. */
  entities: z.array(z.enum(QBO_ENTITY_NAMES)).optional(),
  operations: z
    .array(z.enum(["Create", "Update", "Delete", "Merge", "Void", "Emailed"]))
    .optional(),
});

export const definition: NodeDefinition = {
  type: "QBO_WEBHOOK_TRIGGER",
  version: 1,
  category: "TRIGGER",
  label: "QuickBooks Trigger",
  description:
    "Start the workflow when a record changes in the connected QuickBooks company. Every payload is signature-verified before anything runs.",
  icon: "Webhook",
  logo: QBO_LOGO,
  keywords: [
    "quickbooks",
    "qbo",
    "webhook",
    "trigger",
    "invoice",
    "accounting",
  ],
  configSchema,
  defaults: { entities: ["Invoice"], operations: ["Create", "Update"] },
  inputs: [],
  outputs: [{ id: "main", label: "Out" }],
  credentials: [
    { key: "credentialId", type: QBO_CREDENTIAL_TYPE, required: true },
  ],
  docsUrl: "/docs/nodes/QBO_WEBHOOK_TRIGGER",
};
