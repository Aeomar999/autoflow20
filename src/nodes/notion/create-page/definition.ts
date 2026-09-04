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
  /** Database URL or id. The page becomes a row in it. */
  databaseId: freeText(2048).optional(),
  /**
   * Column values as a JSON object of `{ "Column name": "value" }`. Each value
   * is wrapped for that column's declared type, read from the database schema.
   */
  properties: freeText(32_000).optional(),
  /** Plain text appended as paragraph blocks in the page body. */
  content: freeText(32_000).optional(),
});

export const definition: NodeDefinition = {
  type: "NOTION_CREATE_PAGE",
  version: 1,
  category: "ACTION",
  label: "Notion Create Page",
  description:
    "Add a row to a Notion database. Column values are wrapped to match the database's own schema, so you write plain strings rather than Notion's property union.",
  icon: "FilePlus",
  logo: NOTION_LOGO,
  keywords: ["notion", "page", "database", "row", "create", "record"],
  configSchema,
  defaults: {},
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  credentials: [
    { key: "credentialId", type: NOTION_CREDENTIAL_TYPE, required: true },
  ],
  docsUrl: "/docs/nodes/NOTION_CREATE_PAGE",
};
