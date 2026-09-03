import "server-only";
import { NonRetriableError } from "inngest";
import { updateSheetRow } from "@/features/google/server/sheets";
import type { NodeRun } from "@/nodes/types";

type SheetsUpdateData = {
  variableName?: string;
  credentialId?: string;
  spreadsheetId?: string;
  sheetName?: string;
  rowNumber?: string;
  values?: string;
};

export const execute: NodeRun<SheetsUpdateData> = async ({
  data,
  context,
  resolve,
  step,
  credentials,
}) =>
  step.run("sheets-update", async () => {
    if (!data.variableName) {
      throw new NonRetriableError(
        "Google Sheets Update node: Variable name not configured",
      );
    }
    for (const [key, label] of [
      ["spreadsheetId", "Spreadsheet ID"],
      ["sheetName", "Sheet name"],
      ["rowNumber", "Row number"],
      ["values", "Values"],
    ] as const) {
      if (!data[key]) {
        throw new NonRetriableError(
          `Google Sheets Update node: ${label} not configured`,
        );
      }
    }

    const rendered = resolve(data.rowNumber as string).trim();
    const rowNumber = Number.parseInt(rendered, 10);
    if (!Number.isInteger(rowNumber) || rowNumber < 1) {
      // Naming the rendered value matters: this is almost always a template
      // that resolved to "" because the upstream field was misspelled, and
      // "row number must be a positive integer" alone does not say that.
      throw new NonRetriableError(
        `Google Sheets Update node: the row number resolved to "${rendered}", which is not a row. Point it at a row number, e.g. {{row.rowNumber}} from a Sheets Read.`,
      );
    }

    let values: unknown;
    try {
      values = JSON.parse(resolve(data.values as string));
    } catch {
      throw new NonRetriableError(
        "Google Sheets Update node: Values must be a JSON array of cells",
      );
    }
    if (!Array.isArray(values)) {
      throw new NonRetriableError(
        "Google Sheets Update node: Values must be a JSON array of cells",
      );
    }

    const result = await updateSheetRow({
      secret: credentials?.credentialId,
      spreadsheetId: resolve(data.spreadsheetId as string),
      sheetName: resolve(data.sheetName as string),
      rowNumber,
      values: values.map((cell) =>
        typeof cell === "string" ? resolve(cell) : cell,
      ),
      where: "Google Sheets Update node",
    });

    return {
      ...context,
      [data.variableName]: { ...result, rowNumber },
    };
  });
