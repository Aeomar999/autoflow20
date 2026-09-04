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
  /** Tab name, e.g. `Sheet1`. */
  sheetName: freeText(1024).optional(),
  /**
   * 1-based row to overwrite. Nine of the automations write back to the row
   * they read, so this is normally `{{row.rowNumber}}` from a SHEETS_READ.
   */
  rowNumber: freeText(64).optional(),
  /** JSON array of cell values, left to right. Strings are templated. */
  values: freeText(65_536).optional(),
});

export const definition: NodeDefinition = {
  type: "SHEETS_UPDATE",
  version: 1,
  category: "ACTION",
  label: "Google Sheets Update Row",
  description:
    "Overwrite the cells of one row — normally the row a Sheets Read returned.",
  icon: "Table2",
  logo: "/logos/google-sheets.png",
  keywords: ["google", "sheets", "update", "row", "write", "spreadsheet"],
  configSchema,
  defaults: {},
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  credentials: [
    { key: "credentialId", type: SHEETS_CREDENTIAL_TYPE, required: true },
  ],
  docsUrl: "/docs/nodes/SHEETS_UPDATE",
};
