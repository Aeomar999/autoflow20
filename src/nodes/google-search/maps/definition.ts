import { z } from "zod";
import {
  GOOGLE_MAPS_CREDENTIAL_TYPE,
  GOOGLE_MAPS_LOGO,
  GOOGLE_MAPS_MAX_RESULTS,
} from "@/features/google-search/constants";
import type { NodeDefinition } from "@/nodes/types";
import {
  credentialIdRef,
  freeText,
  variableNameSchema,
} from "../../shared/config-fields";

export const configSchema = z.object({
  variableName: variableNameSchema.optional(),
  credentialId: credentialIdRef(),
  /** Free-text query, e.g. "dentists in Leeds". */
  query: freeText(1024).optional(),
  limit: z.number().int().min(1).max(GOOGLE_MAPS_MAX_RESULTS).optional(),
  /** Bias results toward a place, e.g. "Leeds, UK". */
  region: freeText(128).optional(),
  /**
   * Ask for contact details (phone, website, opening hours). Google bills
   * these on a higher SKU than name-and-address alone.
   */
  includeContactDetails: z.boolean().optional(),
});

export const definition: NodeDefinition = {
  type: "GOOGLE_MAPS_SEARCH",
  version: 1,
  category: "DATA",
  label: "Google Maps Search",
  description:
    "Find places by text query and return name, address and rating — with phone and website when asked for. Every request is billed, and the field mask the node sends decides which price tier applies.",
  icon: "MapPin",
  logo: GOOGLE_MAPS_LOGO,
  keywords: ["google", "maps", "places", "local", "business", "lead"],
  configSchema,
  defaults: { limit: 20, includeContactDetails: false },
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  credentials: [
    { key: "credentialId", type: GOOGLE_MAPS_CREDENTIAL_TYPE, required: true },
  ],
  docsUrl: "/docs/nodes/GOOGLE_MAPS_SEARCH",
};
