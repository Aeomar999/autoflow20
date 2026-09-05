import { z } from "zod";
import { QBO_ENTITY_NAMES } from "@/features/quickbooks/entity-names";
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
  entity: z.enum(QBO_ENTITY_NAMES).optional(),
  entityId: freeText(64).optional(),
  /** File reference expression: {{{json downloaded.file}}}. */
  file: freeText(8192).optional(),
  /** Also attach to the copy QuickBooks emails the customer. */
  includeOnSend: z.boolean().optional(),
});

export const definition: NodeDefinition = {
  type: "QBO_ATTACH",
  version: 1,
  category: "ACTION",
  label: "QuickBooks Attach File",
  description:
    "Attach a stored file to a QuickBooks record — a supplier invoice on a bill, a receipt on an expense. Optionally include it on the copy QuickBooks emails.",
  icon: "Paperclip",
  logo: QBO_LOGO,
  keywords: ["quickbooks", "qbo", "attach", "file", "receipt", "accounting"],
  configSchema,
  defaults: { entity: "Invoice", includeOnSend: false },
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  credentials: [
    { key: "credentialId", type: QBO_CREDENTIAL_TYPE, required: true },
  ],
  docsUrl: "/docs/nodes/QBO_ATTACH",
};
