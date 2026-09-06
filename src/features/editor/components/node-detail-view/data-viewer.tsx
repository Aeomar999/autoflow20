"use client";

import { useMemo, useState } from "react";

/**
 * Read-only payload renderer shared by the Input and Output panes (AF-UX-15).
 *
 * Node payloads are arbitrary JSON, so the table view is best-effort: an array
 * of flat objects becomes columns, a single object becomes one row, and
 * anything else falls back to JSON with the toggle hidden rather than
 * rendering an empty table that looks like missing data.
 */

/**
 * Rows for the table view, or `null` when the value cannot be tabulated.
 * A nested value is kept as-is; the cell renderer stringifies it.
 */
export function toTableRows(value: unknown): Record<string, unknown>[] | null {
  const isPlainObject = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v);

  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    return value.every(isPlainObject)
      ? (value as Record<string, unknown>[])
      : null;
  }
  return isPlainObject(value) ? [value] : null;
}

function cellText(value: unknown): string {
  if (value === undefined || value === null) return "—";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export function DataViewer({
  value,
  label,
}: {
  value: unknown;
  label: string;
}) {
  const rows = useMemo(() => toTableRows(value), [value]);
  const [mode, setMode] = useState<"table" | "json">("table");

  const columns = useMemo(() => {
    if (!rows) return [];
    // Union of keys across rows, first-seen order — a node that omits a field
    // on some items must not silently drop the column.
    const seen: string[] = [];
    for (const row of rows) {
      for (const key of Object.keys(row)) {
        if (!seen.includes(key)) seen.push(key);
      }
    }
    return seen;
  }, [rows]);

  const showTable = rows !== null && mode === "table";

  return (
    <div className="flex min-h-0 flex-col gap-2">
      {rows !== null ? (
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-label={`${label} as table`}
            aria-pressed={mode === "table"}
            onClick={() => setMode("table")}
            className={`rounded-md px-2 py-0.5 text-xs ${
              mode === "table"
                ? "bg-muted font-medium text-foreground"
                : "text-muted-foreground hover:bg-muted/50"
            }`}
          >
            Table
          </button>
          <button
            type="button"
            aria-label={`${label} as JSON`}
            aria-pressed={mode === "json"}
            onClick={() => setMode("json")}
            className={`rounded-md px-2 py-0.5 text-xs ${
              mode === "json"
                ? "bg-muted font-medium text-foreground"
                : "text-muted-foreground hover:bg-muted/50"
            }`}
          >
            JSON
          </button>
          <span className="ml-auto text-[10px] text-muted-foreground">
            {rows.length} {rows.length === 1 ? "item" : "items"}
          </span>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border bg-muted/30">
        {showTable ? (
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 bg-muted">
              <tr>
                {columns.map((column) => (
                  <th
                    key={column}
                    className="border-b border-border px-2 py-1 text-left font-medium text-muted-foreground"
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                // Node payload rows have no stable id of their own, and the
                // list is never reordered — index is the honest key here.
                // biome-ignore lint/suspicious/noArrayIndexKey: see above
                <tr key={rowIndex} className="even:bg-muted/40">
                  {columns.map((column) => (
                    <td
                      key={column}
                      className="border-b border-border/50 px-2 py-1 align-top font-mono"
                    >
                      {cellText(row[column])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <pre className="overflow-auto p-2 font-mono text-xs leading-relaxed">
            {JSON.stringify(value, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}
