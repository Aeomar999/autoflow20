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
  /** Unique in the company. QBO rejects a duplicate with error 6240. */
  displayName: freeText(512).optional(),
  email: freeText(320).optional(),
  phone: freeText(64).optional(),
  companyName: freeText(512).optional(),
});

export const definition: NodeDefinition = {
  type: "QBO_CREATE_CUSTOMER",
  version: 1,
  category: "ACTION",
  label: "QuickBooks Create Customer",
  description:
    "Create a QuickBooks customer. Display names are unique per company, so pair this with a Find Customer on the branch where nothing was found.",
  icon: "UserPlus",
  logo: QBO_LOGO,
  keywords: ["quickbooks", "qbo", "customer", "create", "accounting"],
  configSchema,
  defaults: {},
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  credentials: [
    { key: "credentialId", type: QBO_CREDENTIAL_TYPE, required: true },
  ],
  docsUrl: "/docs/nodes/QBO_CREATE_CUSTOMER",
};
