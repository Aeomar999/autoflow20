import { z } from "zod";
import {
  GOOGLE_SEARCH_CREDENTIAL_TYPE,
  GOOGLE_SEARCH_LOGO,
  GOOGLE_SEARCH_MAX_RESULTS,
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
  query: freeText(2048).optional(),
  /** Google caps the whole result set at 100, ten per request. */
  limit: z.number().int().min(1).max(GOOGLE_SEARCH_MAX_RESULTS).optional(),
  /** Restrict to one site, e.g. `example.com`. */
  siteSearch: freeText(256).optional(),
  /** Two-letter language, e.g. `lang_en`. */
  language: freeText(16).optional(),
  dateRestrict: freeText(16).optional(),
});

export const definition: NodeDefinition = {
  type: "GOOGLE_SEARCH",
  version: 1,
  category: "DATA",
  label: "Google Search",
  description:
    "Run a Custom Search query and return the results. Metered: 100 queries a day are free and every one after that is billed, so the node caps results and says when it stopped.",
  icon: "Search",
  logo: GOOGLE_SEARCH_LOGO,
  keywords: ["google", "search", "web", "serp", "results", "research"],
  configSchema,
  defaults: { limit: 10 },
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  credentials: [
    {
      key: "credentialId",
      type: GOOGLE_SEARCH_CREDENTIAL_TYPE,
      required: true,
    },
  ],
  docsUrl: "/docs/nodes/GOOGLE_SEARCH",
};
