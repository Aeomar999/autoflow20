import "server-only";
import { NonRetriableError } from "inngest";
import { readSheet } from "@/features/google/server/sheets";
import type { NodeRun } from "@/nodes/types";

type SheetsReadData = {
  variableName?: string;
  credentialId?: string;
  spreadsheetId?: string;
  range?: string;
  hasHeader?: boolean;
  limit?: number;
};

export const execute: NodeRun<SheetsReadData> = async ({
  data,
  context,
  resolve,
  step,
  credentials,
}) =>
  step.run("sheets-read", async () => {
    if (!data.variableName) {
      throw new NonRetriableError(
        "Google Sheets Read node: Variable name not configured",
      );
    }
    if (!data.spreadsheetId) {
      throw new NonRetriableError(
        "Google Sheets Read node: Spreadsheet ID not configured",
      );
    }
    if (!data.range) {
      throw new NonRetriableError(
        "Google Sheets Read node: Range not configured (e.g. Sheet1!A1:F200)",
      );
    }

    const result = await readSheet({
      secret: credentials?.credentialId,
      spreadsheetId: resolve(data.spreadsheetId),
      range: resolve(data.range),
      hasHeader: data.hasHeader !== false,
      limit: data.limit ?? 500,
      where: "Google Sheets Read node",
    });

    return {
      ...context,
      [data.variableName]: {
        rows: result.rows,
        headers: result.headers,
        count: result.rows.length,
        range: result.range,
        // Reported, never silent: a workflow that processed the first 500 of
        // 2,000 rows and reported success is the failure this prevents.
        truncated: result.truncated,
      },
    };
  });
