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
  /** Allowlisted: this becomes part of a URL path. */
  entity: z.enum(QBO_ENTITY_NAMES).optional(),
  /** Numeric QBO id. From a webhook event, this is {{qbo.entityId}}. */
  entityId: freeText(64).optional(),
});

export const definition: NodeDefinition = {
  type: "QBO_GET",
  version: 1,
  category: "DATA",
  label: "QuickBooks Get Record",
  description:
    "Read one QuickBooks record by type and id. Pairs with the webhook trigger, which reports what changed but not what it now says.",
  icon: "Search",
  logo: QBO_LOGO,
  keywords: ["quickbooks", "qbo", "get", "read", "record", "accounting"],
  configSchema,
  defaults: { entity: "Invoice" },
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  credentials: [
    { key: "credentialId", type: QBO_CREDENTIAL_TYPE, required: true },
  ],
  docsUrl: "/docs/nodes/QBO_GET",
};
