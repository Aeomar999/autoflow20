import { z } from "zod";
import type { NodeDefinition } from "@/nodes/types";
import {
  credentialIdRef,
  freeText,
  variableNameSchema,
} from "../../shared/config-fields";

export const configSchema = z.object({
  /** Result key in the run context: {{variableName.updates.updatedRange}} */
  variableName: variableNameSchema.optional(),
  /** Google Sheets OAuth credential (accessToken granted via Google OAuth). */
  credentialId: credentialIdRef(),
  /** The spreadsheet's `spreadsheetId` (from its shareable URL). */
  spreadsheetId: freeText(1024).optional(),
  /** Tab name or A1-style range to append after, e.g. "Sheet1". */
  sheetName: freeText(1024).optional(),
  /**
   * JSON array of rows to append. String cells are template-compiled at run
   * time; numbers, booleans, and null pass through; object cells serialize.
   */
  values: freeText(65_536).optional(),
});

export const definition: NodeDefinition = {
  type: "GOOGLE_SHEETS_APPEND",
  version: 1,
  category: "ACTION",
  label: "Google Sheets Append",
  description:
    "Append rows to a Google Sheets spreadsheet and store where they landed.",
  icon: "Table2",
  logo: "/logos/google-sheets.png",
  keywords: ["google", "sheets", "spreadsheet", "append", "row", "gsheet"],
  configSchema,
  defaults: {},
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  /**
   * (AF-M10-03) Accepts the scoped type for new bindings and the deprecated
   * `google.oauth2` for nodes saved before the split — ADR-0011's retirement
   * rule applied to credentials. Re-pointing saved nodes at a type the user has
   * not connected would break running workflows to tidy up a registry.
   */
  credentials: [
    {
      key: "credentialId",
      type: "google.sheets|google.oauth2",
      required: true,
    },
  ],
};
