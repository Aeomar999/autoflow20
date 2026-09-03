import { z } from "zod";
import type { NodeDefinition } from "@/nodes/types";
import {
  credentialIdRef,
  freeText,
  variableNameSchema,
} from "../../shared/config-fields";

/**
 * Accepts either the scoped `google.sheets` type or the deprecated
 * `google.oauth2` during its overlap window (AF-M10-03, ADR-0023).
 */
export const SHEETS_CREDENTIAL_TYPE = "google.sheets|google.oauth2";

export const configSchema = z.object({
  variableName: variableNameSchema.optional(),
  credentialId: credentialIdRef(),
  /** The spreadsheet's id, from its URL. */
  spreadsheetId: freeText(1024).optional(),
  /** A1 range, e.g. `Sheet1!A1:F200`. A bare tab name reads the used range. */
  range: freeText(1024).optional(),
  /**
   * When true (the default), row 1 names the columns and each row is also
   * available as `fields.<Column Name>`.
   */
  hasHeader: z.boolean().optional(),
  /** Rows to return. */
  limit: z.number().int().min(1).max(5000).optional(),
});

export const definition: NodeDefinition = {
  type: "SHEETS_READ",
  version: 1,
  category: "DATA",
  label: "Google Sheets Read",
  description:
    "Read a range from a spreadsheet as rows, addressable by column name.",
  icon: "Table2",
  logo: "/logos/google-sheets.png",
  keywords: ["google", "sheets", "read", "rows", "spreadsheet", "range"],
  configSchema,
  defaults: { hasHeader: true, limit: 500 },
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  credentials: [
    { key: "credentialId", type: SHEETS_CREDENTIAL_TYPE, required: true },
  ],
  docsUrl: "/docs/nodes/SHEETS_READ",
};
