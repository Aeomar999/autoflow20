import { z } from "zod";
import {
  APOLLO_CREDENTIAL_TYPE,
  APOLLO_LOGO,
} from "@/features/apollo/constants";
import type { NodeDefinition } from "@/nodes/types";
import {
  credentialIdRef,
  freeText,
  variableNameSchema,
} from "../../shared/config-fields";

export const configSchema = z.object({
  variableName: variableNameSchema.optional(),
  credentialId: credentialIdRef(),
  mode: z.enum(["person", "organization"]).optional(),
  /** Person mode: the strongest single signal Apollo can match on. */
  email: freeText(320).optional(),
  firstName: freeText(128).optional(),
  lastName: freeText(128).optional(),
  /** Organization mode, and a useful disambiguator in person mode. */
  domain: freeText(256).optional(),
  /** Ask Apollo to reveal a work email. Spends an extra credit. */
  revealPersonalEmails: z.boolean().optional(),
});

export const definition: NodeDefinition = {
  type: "APOLLO_ENRICH",
  version: 1,
  category: "DATA",
  label: "Apollo Enrich",
  description:
    "Look up a person or a company in Apollo and return the matched record. A miss is reported as found: false rather than failing, so a list can be enriched without one unknown contact stopping the run.",
  icon: "UserSearch",
  logo: APOLLO_LOGO,
  keywords: ["apollo", "enrich", "lead", "contact", "company", "prospect"],
  configSchema,
  defaults: { mode: "person", revealPersonalEmails: false },
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  credentials: [
    { key: "credentialId", type: APOLLO_CREDENTIAL_TYPE, required: true },
  ],
  docsUrl: "/docs/nodes/APOLLO_ENRICH",
};
