import { z } from "zod";
import type { NodeDefinition } from "@/nodes/types";
import {
  credentialIdRef,
  freeText,
  variableNameSchema,
} from "../../shared/config-fields";

export const configSchema = z.object({
  variableName: variableNameSchema.optional(),
  credentialId: credentialIdRef(),
  baseId: freeText(2048).optional(),
  tableId: freeText(2048).optional(),
  /** Airtable formula, e.g. `{Status} = "Active"`. Runs server-side. */
  filterByFormula: freeText(4096).optional(),
  view: freeText(256).optional(),
  sortField: freeText(256).optional(),
  sortDirection: z.enum(["asc", "desc"]).optional(),
  limit: z.number().int().min(1).max(5000).optional(),
});

export const definition: NodeDefinition = {
  type: "AIRTABLE_READ",
  version: 1,
  category: "DATA",
  label: "Airtable Read Records",
  description:
    "Read records from a table, filtered server-side with a formula. Paging is bounded and truncation is reported.",
  icon: "Table",
  logo: "/logos/airtable.png",
  keywords: ["airtable", "read", "records", "query", "filter", "base"],
  configSchema,
  defaults: { limit: 100, sortDirection: "asc" },
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  credentials: [
    { key: "credentialId", type: "airtable.apiKey", required: true },
  ],
  docsUrl: "/docs/nodes/AIRTABLE_READ",
};
