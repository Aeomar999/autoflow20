import { z } from "zod";
import type { NodeDefinition } from "@/nodes/types";
import { credentialIdRef, freeText } from "../../shared/config-fields";
import { SHEETS_CREDENTIAL_TYPE } from "../read/definition";

export const configSchema = z.object({
  credentialId: credentialIdRef(),
  spreadsheetId: freeText(1024).optional(),
  /** Range watched, e.g. `Sheet1!A1:F1000`. Row 1 must name the columns. */
  range: freeText(1024).optional(),
  /**
   * Column whose value identifies a row. Rows are remembered by this value, so
   * it must be unique and stable — an id, an email, an order number. Leave
   * empty to identify a row by its position, which is only safe on a sheet
   * that is appended to and never sorted or re-ordered.
   */
  keyColumn: freeText(256).optional(),
  /** Seconds between polls. Floored at 60 by the sweep. */
  pollIntervalSeconds: z.number().int().min(60).max(86_400).optional(),
});

export const definition: NodeDefinition = {
  type: "SHEETS_TRIGGER",
  version: 1,
  category: "TRIGGER",
  label: "Google Sheets New Row",
  description:
    "Start the workflow for each new row added to a sheet. Rows already present when the trigger is activated are not replayed.",
  icon: "Table2",
  logo: "/logos/google-sheets.png",
  keywords: ["google", "sheets", "trigger", "new row", "poll", "spreadsheet"],
  configSchema,
  defaults: { pollIntervalSeconds: 300 },
  inputs: [],
  outputs: [{ id: "main", label: "Out" }],
  credentials: [
    { key: "credentialId", type: SHEETS_CREDENTIAL_TYPE, required: true },
  ],
  docsUrl: "/docs/nodes/SHEETS_TRIGGER",
};
