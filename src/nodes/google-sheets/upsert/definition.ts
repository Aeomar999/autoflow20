import { z } from "zod";
import type { NodeDefinition } from "@/nodes/types";
import {
  credentialIdRef,
  freeText,
  variableNameSchema,
} from "../../shared/config-fields";
import { SHEETS_CREDENTIAL_TYPE } from "../read/definition";

export const configSchema = z.object({
  variableName: variableNameSchema.optional(),
  credentialId: credentialIdRef(),
  spreadsheetId: freeText(1024).optional(),
  sheetName: freeText(1024).optional(),
  /** Range searched for a match, e.g. `Sheet1!A1:F1000`. */
  range: freeText(1024).optional(),
  /** Column NAME whose value identifies a row (requires a header row). */
  matchColumn: freeText(256).optional(),
  /** Value to look for in that column. Templated. */
  matchValue: freeText(2048).optional(),
  /** JSON array of cell values for the row, left to right. */
  values: freeText(65_536).optional(),
});

export const definition: NodeDefinition = {
  type: "SHEETS_UPSERT",
  version: 1,
  category: "ACTION",
  label: "Google Sheets Upsert Row",
  description:
    "Update the row whose key column matches, or append one if none does.",
  icon: "Table2",
  logo: "/logos/google-sheets.png",
  keywords: ["google", "sheets", "upsert", "match", "row", "sync"],
  configSchema,
  defaults: {},
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  credentials: [
    { key: "credentialId", type: SHEETS_CREDENTIAL_TYPE, required: true },
  ],
  docsUrl: "/docs/nodes/SHEETS_UPSERT",
};
