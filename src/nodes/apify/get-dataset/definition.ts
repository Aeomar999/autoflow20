import { z } from "zod";
import {
  APIFY_CREDENTIAL_TYPE,
  APIFY_DEFAULT_ITEMS,
  APIFY_LOGO,
  APIFY_MAX_ITEMS,
} from "@/features/apify/constants";
import type { NodeDefinition } from "@/nodes/types";
import {
  credentialIdRef,
  freeText,
  variableNameSchema,
} from "../../shared/config-fields";

export const configSchema = z.object({
  variableName: variableNameSchema.optional(),
  credentialId: credentialIdRef(),
  /** Usually `{{run.datasetId}}` from an Apify Run node. */
  datasetId: freeText(256).optional(),
  limit: z.number().int().min(1).max(APIFY_MAX_ITEMS).optional(),
  offset: z.number().int().min(0).optional(),
  /** Drop empty items and Apify's internal `#` fields. */
  clean: z.boolean().optional(),
});

export const definition: NodeDefinition = {
  type: "APIFY_GET_DATASET",
  version: 1,
  category: "DATA",
  label: "Apify Get Dataset",
  description:
    "Fetch the items an actor produced, paginated and capped. Truncation is reported, so a partial read never looks like a complete one.",
  icon: "Database",
  logo: APIFY_LOGO,
  keywords: ["apify", "dataset", "items", "results", "scrape", "fetch"],
  configSchema,
  defaults: { limit: APIFY_DEFAULT_ITEMS, offset: 0, clean: true },
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  credentials: [
    { key: "credentialId", type: APIFY_CREDENTIAL_TYPE, required: true },
  ],
  docsUrl: "/docs/nodes/APIFY_GET_DATASET",
};
