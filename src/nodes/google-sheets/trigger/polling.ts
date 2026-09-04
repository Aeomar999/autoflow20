import "server-only";
import { readSheet } from "@/features/google/server/sheets";
import type { PollingTrigger } from "@/nodes/types";

type SheetsTriggerConfig = {
  spreadsheetId?: string;
  range?: string;
  keyColumn?: string;
};

/**
 * `SHEETS_TRIGGER`'s poller (AF-M10-15 on the AF-M10-05 framework).
 *
 * Roughly forty lines, which is the point of ADR-0024: dispatch, dedupe,
 * cursor persistence, backoff and the no-history-replay rule all belong to the
 * framework. This answers one question — what rows are in the sheet? — and
 * gives each a stable id.
 */
export const polling: PollingTrigger<SheetsTriggerConfig> = {
  defaultIntervalSeconds: 300,

  async poll({ config, credentials, limit }) {
    if (!config.spreadsheetId || !config.range) {
      throw new Error(
        "Google Sheets trigger: spreadsheet and range must be configured.",
      );
    }

    const sheet = await readSheet({
      secret: credentials?.credentialId,
      spreadsheetId: config.spreadsheetId,
      range: config.range,
      hasHeader: true,
      // Read more than one dispatch window: the framework caps what it
      // dispatches, and reading exactly `limit` would make a backlog look like
      // the whole sheet.
      limit: 1000,
      where: "Google Sheets trigger",
    });

    const keyColumn = config.keyColumn?.trim();

    const items = sheet.rows
      .map((row) => {
        // A key column gives a row an identity that survives sorting. Without
        // one the row NUMBER is the identity, which is only safe on a sheet
        // that is appended to and never re-ordered — the node's config field
        // says exactly that.
        const id = keyColumn
          ? (row.fields[keyColumn] ?? "").trim()
          : `row:${row.rowNumber}`;

        return id.length > 0
          ? {
              id,
              data: {
                row: {
                  rowNumber: row.rowNumber,
                  fields: row.fields,
                  cells: row.cells,
                },
                sheet: {
                  spreadsheetId: config.spreadsheetId,
                  range: sheet.range,
                  headers: sheet.headers,
                },
              },
            }
          : null;
      })
      // A row whose key cell is blank cannot be deduplicated; dispatching it
      // would re-run it on every poll forever.
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .slice(0, limit);

    return {
      items,
      // The cursor is informational here: identity comes from the id window,
      // because a sheet has no "modified since" to resume from.
      cursor: { lastPolledRowCount: sheet.rows.length },
    };
  },
};
