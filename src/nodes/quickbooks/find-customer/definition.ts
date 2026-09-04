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
  /** Exact display name. QBO's query language has no LIKE worth relying on. */
  displayName: freeText(512).optional(),
  /** Email to match instead of, or as well as, the name. */
  email: freeText(320).optional(),
});

export const definition: NodeDefinition = {
  type: "QBO_FIND_CUSTOMER",
  version: 1,
  category: "DATA",
  label: "QuickBooks Find Customer",
  description:
    "Look a QuickBooks customer up by display name or email. Returns found: false rather than failing when there is no match, so a find-or-create branch works.",
  icon: "UserSearch",
  logo: QBO_LOGO,
  keywords: ["quickbooks", "qbo", "customer", "find", "search", "accounting"],
  configSchema,
  defaults: {},
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  credentials: [
    { key: "credentialId", type: QBO_CREDENTIAL_TYPE, required: true },
  ],
  docsUrl: "/docs/nodes/QBO_FIND_CUSTOMER",
};
