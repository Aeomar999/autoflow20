import { z } from "zod";
import type { NodeDefinition } from "@/nodes/types";
import {
  credentialIdRef,
  freeText,
  variableNameSchema,
} from "../../shared/config-fields";

export const configSchema = z.object({
  /** Result key in the run context: {{variableName.id}} */
  variableName: variableNameSchema.optional(),
  /** HubSpot private app access token (Bearer token for api.hubapi.com). */
  credentialId: credentialIdRef(),
  /**
   * JSON object of contact property name to value. String values are
   * template-compiled at run time; numbers, booleans, null, and arrays pass
   * through.
   */
  properties: freeText(65_536).optional(),
});

export const definition: NodeDefinition = {
  type: "HUBSPOT_CREATE_CONTACT",
  version: 1,
  category: "ACTION",
  label: "HubSpot Create Contact",
  description:
    "Create a contact in HubSpot and store the returned contact object.",
  icon: "Contact",
  logo: "/logos/hubspot.png",
  keywords: ["hubspot", "create", "contact", "crm", "lead"],
  configSchema,
  defaults: {},
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  credentials: [
    { key: "credentialId", type: "hubspot.apiKey", required: true },
  ],
};
