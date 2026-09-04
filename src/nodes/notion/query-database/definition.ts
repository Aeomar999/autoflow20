import { z } from "zod";
import {
  NOTION_CREDENTIAL_TYPE,
  NOTION_LOGO,
} from "@/features/notion/constants";
import type { NodeDefinition } from "@/nodes/types";
import {
  credentialIdRef,
  freeText,
  variableNameSchema,
} from "../../shared/config-fields";

export const configSchema = z.object({
  variableName: variableNameSchema.optional(),
  credentialId: credentialIdRef(),
  databaseId: freeText(2048).optional(),
  /** Notion filter object as JSON. Blank returns everything. */
  filter: freeText(16_000).optional(),
  /** Column to sort by. */
  sortProperty: freeText(256).optional(),
  sortDirection: z.enum(["ascending", "descending"]).optional(),
  limit: z.number().int().min(1).max(1000).optional(),
});

export const definition: NodeDefinition = {
  type: "NOTION_QUERY_DATABASE",
  version: 1,
  category: "DATA",
  label: "Notion Query Database",
  description:
    "Read rows from a Notion database with an optional filter and sort. Property values are flattened to plain strings, numbers and lists.",
  icon: "Table",
  logo: NOTION_LOGO,
  keywords: ["notion", "database", "query", "rows", "filter", "read"],
  configSchema,
  defaults: { limit: 100, sortDirection: "descending" },
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  credentials: [
    { key: "credentialId", type: NOTION_CREDENTIAL_TYPE, required: true },
  ],
  docsUrl: "/docs/nodes/NOTION_QUERY_DATABASE",
};
