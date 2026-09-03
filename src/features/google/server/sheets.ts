import "server-only";
import { NonRetriableError } from "inngest";
import type { CredentialSecret } from "@/features/credentials/server/vault";
import { googleFetch } from "./google-client";

/**
 * Google Sheets operations (AF-M10-15).
 *
 * 16 of the 35 automations read a sheet and 9 write back to a specific row.
 * The shared piece is not the HTTP call — it is the **header mapping**: every
 * one of those automations addresses columns by name, and every one of them
 * would otherwise reimplement "row 1 is the header, map the rest onto it".
 */

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";

/** Rows one read returns. Sheets itself caps a response long before this. */
export const MAX_SHEET_ROWS = 5000;

export interface SheetRow {
  /** 1-based row number in the sheet, so a write can address it back. */
  rowNumber: number;
  /** Column-name → cell value, when the range has a header row. */
  fields: Record<string, string>;
  /** The raw cells, in column order. */
  cells: string[];
}

export interface ReadSheetResult {
  rows: SheetRow[];
  headers: string[];
  /** A1 range the values actually came from. */
  range: string;
  truncated: boolean;
}

/**
 * A1 column label for a zero-based index: 0 → A, 25 → Z, 26 → AA.
 *
 * Needed because an update addresses a cell by label, and a sheet with more
 * than 26 columns is entirely ordinary.
 */
export function columnLabel(index: number): string {
  let label = "";
  let n = index;
  while (n >= 0) {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  }
  return label;
}

/**
 * Map data rows onto a header row.
 *
 * Two decisions worth stating:
 *
 * - **Short rows are padded, not skipped.** Sheets omits trailing empty cells,
 *   so a row whose last column is blank comes back shorter than the header. A
 *   naive zip drops the field entirely and `{{row.fields.Status}}` renders as
 *   nothing — which reads identically to "the status is empty" and is how a
 *   filter silently matches the wrong rows.
 * - **Duplicate headers keep the first.** A sheet with two `Email` columns is
 *   a mistake, but overwriting silently would make the second one win at
 *   random depending on column order.
 */
export function mapRowsToFields(
  values: string[][],
  options: { hasHeader: boolean; startRow: number },
): { headers: string[]; rows: SheetRow[] } {
  if (values.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = options.hasHeader
    ? values[0].map((header, index) =>
        header.trim().length > 0 ? header.trim() : `Column${index + 1}`,
      )
    : values[0].map((_, index) => columnLabel(index));

  const dataRows = options.hasHeader ? values.slice(1) : values;
  const firstDataRow = options.startRow + (options.hasHeader ? 1 : 0);

  const rows = dataRows.map((cells, index) => {
    const fields: Record<string, string> = {};
    headers.forEach((header, column) => {
      if (!(header in fields)) {
        fields[header] = cells[column] ?? "";
      }
    });
    return {
      rowNumber: firstDataRow + index,
      fields,
      cells: headers.map((_, column) => cells[column] ?? ""),
    };
  });

  return { headers, rows };
}

/** Read a range and map it onto its header row. */
export async function readSheet(args: {
  secret: CredentialSecret | undefined;
  spreadsheetId: string;
  range: string;
  hasHeader: boolean;
  limit: number;
  where: string;
}): Promise<ReadSheetResult> {
  const response = await googleFetch<{
    range?: string;
    values?: string[][];
  }>(args.secret, {
    url: `${SHEETS_API}/${encodeURIComponent(args.spreadsheetId)}/values/${encodeURIComponent(args.range)}`,
    query: {
      // Formatted values, so a currency cell reads as the user sees it rather
      // than as a raw float — these values are usually going into an email.
      valueRenderOption: "FORMATTED_VALUE",
      dateTimeRenderOption: "FORMATTED_STRING",
    },
    where: args.where,
  });

  const values = response.values ?? [];
  const limit = Math.min(args.limit, MAX_SHEET_ROWS);

  // The row a range starts at, so `rowNumber` addresses the real sheet.
  const startRow = startRowOf(response.range ?? args.range);

  const { headers, rows } = mapRowsToFields(values, {
    hasHeader: args.hasHeader,
    startRow,
  });

  return {
    headers,
    rows: rows.slice(0, limit),
    range: response.range ?? args.range,
    truncated: rows.length > limit,
  };
}

/** `Sheet1!A2:D50` → 2. Absent or malformed bounds mean the sheet's first row. */
export function startRowOf(range: string): number {
  const bounds = range.includes("!") ? range.split("!")[1] : range;
  const match = /^[A-Z]*(\d+)/.exec(bounds ?? "");
  return match ? Number.parseInt(match[1], 10) : 1;
}

/** Overwrite the cells of one row. */
export async function updateSheetRow(args: {
  secret: CredentialSecret | undefined;
  spreadsheetId: string;
  sheetName: string;
  rowNumber: number;
  values: unknown[];
  where: string;
}): Promise<{ updatedRange: string; updatedCells: number }> {
  if (args.rowNumber < 1) {
    throw new NonRetriableError(
      `${args.where}: row number must be 1 or greater (received ${args.rowNumber}).`,
    );
  }

  const lastColumn = columnLabel(Math.max(args.values.length - 1, 0));
  const range = `${args.sheetName}!A${args.rowNumber}:${lastColumn}${args.rowNumber}`;

  const response = await googleFetch<{
    updatedRange?: string;
    updatedCells?: number;
  }>(args.secret, {
    url: `${SHEETS_API}/${encodeURIComponent(args.spreadsheetId)}/values/${encodeURIComponent(range)}`,
    method: "PUT",
    query: { valueInputOption: "USER_ENTERED" },
    body: { values: [args.values] },
    where: args.where,
  });

  return {
    updatedRange: response.updatedRange ?? range,
    updatedCells: response.updatedCells ?? 0,
  };
}

/** Append rows to the end of a sheet. */
export async function appendSheetRows(args: {
  secret: CredentialSecret | undefined;
  spreadsheetId: string;
  range: string;
  values: unknown[][];
  where: string;
}): Promise<{ updatedRange: string; updatedRows: number }> {
  const response = await googleFetch<{
    updates?: { updatedRange?: string; updatedRows?: number };
  }>(args.secret, {
    url: `${SHEETS_API}/${encodeURIComponent(args.spreadsheetId)}/values/${encodeURIComponent(args.range)}:append`,
    method: "POST",
    query: {
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
    },
    body: { values: args.values },
    where: args.where,
  });

  return {
    updatedRange: response.updates?.updatedRange ?? args.range,
    updatedRows: response.updates?.updatedRows ?? 0,
  };
}
