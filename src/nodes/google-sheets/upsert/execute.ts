import "server-only";
import { NonRetriableError } from "inngest";
import {
  appendSheetRows,
  readSheet,
  updateSheetRow,
} from "@/features/google/server/sheets";
import type { NodeRun } from "@/nodes/types";

type SheetsUpsertData = {
  variableName?: string;
  credentialId?: string;
  spreadsheetId?: string;
  sheetName?: string;
  range?: string;
  matchColumn?: string;
  matchValue?: string;
  values?: string;
};

export const execute: NodeRun<SheetsUpsertData> = async ({
  data,
  context,
  resolve,
  step,
  credentials,
}) =>
  step.run("sheets-upsert", async () => {
    if (!data.variableName) {
      throw new NonRetriableError(
        "Google Sheets Upsert node: Variable name not configured",
      );
    }
    for (const [key, label] of [
      ["spreadsheetId", "Spreadsheet ID"],
      ["sheetName", "Sheet name"],
      ["range", "Range"],
      ["matchColumn", "Match column"],
      ["matchValue", "Match value"],
      ["values", "Values"],
    ] as const) {
      if (!data[key]) {
        throw new NonRetriableError(
          `Google Sheets Upsert node: ${label} not configured`,
        );
      }
    }

    let values: unknown;
    try {
      values = JSON.parse(resolve(data.values as string));
    } catch {
      throw new NonRetriableError(
        "Google Sheets Upsert node: Values must be a JSON array of cells",
      );
    }
    if (!Array.isArray(values)) {
      throw new NonRetriableError(
        "Google Sheets Upsert node: Values must be a JSON array of cells",
      );
    }

    const secret = credentials?.credentialId;
    const spreadsheetId = resolve(data.spreadsheetId as string);
    const sheetName = resolve(data.sheetName as string);
    const matchColumn = resolve(data.matchColumn as string).trim();
    const matchValue = resolve(data.matchValue as string).trim();
    const where = "Google Sheets Upsert node";

    if (matchValue === "") {
      // An empty key would match the first blank cell in the column and
      // overwrite an unrelated row — silently, and only sometimes.
      throw new NonRetriableError(
        `${where}: the match value resolved to nothing. Upserting on an empty key would overwrite whichever row happens to have a blank ${matchColumn}.`,
      );
    }

    const sheet = await readSheet({
      secret,
      spreadsheetId,
      range: resolve(data.range as string),
      hasHeader: true,
      limit: 5000,
      where,
    });

    if (!sheet.headers.includes(matchColumn)) {
      throw new NonRetriableError(
        `${where}: the sheet has no column named "${matchColumn}". Columns found: ${sheet.headers.join(", ") || "(none)"}.`,
      );
    }

    if (sheet.truncated) {
      // Appending because "no match was found" in a search that did not see
      // every row creates a duplicate. Failing is the honest outcome.
      throw new NonRetriableError(
        `${where}: the search range returned more rows than could be read, so a missing match cannot be trusted. Narrow the range.`,
      );
    }

    const matches = sheet.rows.filter(
      (row) => row.fields[matchColumn]?.trim() === matchValue,
    );

    const cells = values.map((cell) =>
      typeof cell === "string" ? resolve(cell) : cell,
    );

    if (matches.length === 0) {
      const appended = await appendSheetRows({
        secret,
        spreadsheetId,
        range: sheetName,
        values: [cells],
        where,
      });
      return {
        ...context,
        [data.variableName]: {
          action: "appended",
          matchValue,
          ...appended,
        },
      };
    }

    // First match wins, and the count is reported: two rows with the same key
    // is a data problem the user should see, not one to resolve by guessing.
    const target = matches[0];
    const updated = await updateSheetRow({
      secret,
      spreadsheetId,
      sheetName,
      rowNumber: target.rowNumber,
      values: cells,
      where,
    });

    return {
      ...context,
      [data.variableName]: {
        action: "updated",
        matchValue,
        rowNumber: target.rowNumber,
        matchCount: matches.length,
        ...updated,
      },
    };
  });
