"use client";

/**
 * Schema-driven node configuration form (AF-M1-06).
 *
 * Extracted from `node-config-panel.tsx` by AF-UX-15 with no behavioural
 * change: the panel that used to wrap it was replaced by the node detail
 * view, and the field editors had no reason to move with it. `baseFieldClass`
 * is exported because the detail view's header and Settings tab render inputs
 * that must match these.
 */

import { CronExpressionParser } from "cron-parser";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { CredentialField } from "@/features/editor/components/credential-field";
import {
  type ConfigListColumn,
  type ResolvedConfigField,
  resolveConfigFields,
  type UnsupportedConfigFieldError,
} from "@/features/editor/lib/config-schema";
import type { NodeDefinition } from "@/nodes/types";

function CronPreview({ cronStr }: { cronStr: string }) {
  const [preview, setPreview] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const interval = CronExpressionParser.parse(cronStr);
      const nextRuns = [
        interval.next().toISOString() as string,
        interval.next().toISOString() as string,
        interval.next().toISOString() as string,
      ];
      setPreview(nextRuns);
      setError(null);
    } catch (err) {
      setPreview([]);
      setError(err instanceof Error ? err.message : "Invalid cron expression");
    }
  }, [cronStr]);

  if (error) {
    return (
      <div className="text-[10px] text-destructive mt-1">Error: {error}</div>
    );
  }

  return (
    <div className="mt-2 rounded bg-muted/50 p-2 text-xs text-muted-foreground border border-border">
      <p className="font-semibold text-foreground mb-1">Next runs (UTC)</p>
      <ul className="list-disc pl-4 space-y-0.5">
        {preview.map((p) => (
          <li key={p}>{new Date(p).toLocaleString()}</li>
        ))}
      </ul>
    </div>
  );
}

type FieldValue = unknown;

export function baseFieldClass(hasError = false): string {
  return [
    "w-full rounded-md border px-2.5 py-1.5 text-sm shadow-sm outline-none",
    hasError
      ? "border-destructive focus:ring-2 focus:ring-destructive/30"
      : "border-border bg-background focus:ring-2 focus:ring-ring/30",
  ].join(" ");
}

function FieldEditor({
  field,
  inputId,
  value,
  onValueChange,
}: {
  field: ResolvedConfigField;
  inputId: string;
  value: FieldValue;
  onValueChange: (next: FieldValue) => void;
}) {
  switch (field.kind) {
    case "string":
      return (
        <div className="flex flex-col gap-1">
          <input
            id={inputId}
            type="text"
            className={baseFieldClass()}
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onValueChange(e.target.value)}
          />
          {field.key === "cron" && typeof value === "string" && (
            <CronPreview cronStr={value} />
          )}
        </div>
      );
    case "multiline":
      return (
        <textarea
          id={inputId}
          rows={4}
          className={baseFieldClass()}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onValueChange(e.target.value)}
        />
      );
    case "number":
      return (
        <input
          id={inputId}
          type="number"
          className={baseFieldClass()}
          value={typeof value === "number" ? value : ""}
          onChange={(e) =>
            onValueChange(
              Number.isNaN(e.target.valueAsNumber)
                ? undefined
                : e.target.valueAsNumber,
            )
          }
        />
      );
    case "boolean":
      return (
        <input
          id={inputId}
          type="checkbox"
          className="size-4 rounded border-border"
          checked={Boolean(value)}
          onChange={(e) => onValueChange(e.target.checked)}
        />
      );
    case "enum": {
      const enumValues = field.enumValues ?? [];
      const hasValue = typeof value === "string" && enumValues.includes(value);
      return (
        <select
          id={inputId}
          className={baseFieldClass()}
          value={hasValue ? value : ""}
          onChange={(e) =>
            onValueChange(e.target.value === "" ? undefined : e.target.value)
          }
        >
          {!hasValue ? (
            <option value="">Select {field.label.toLowerCase()}…</option>
          ) : null}
          {enumValues.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );
    }
    case "multiEnum": {
      const options = field.enumValues ?? [];
      const selected = Array.isArray(value)
        ? value.filter((v): v is string => typeof v === "string")
        : [];
      return (
        <div
          id={inputId}
          className="flex flex-col gap-1.5 rounded-md border border-border p-2"
        >
          {options.map((option) => (
            <label
              key={option}
              className="flex items-center gap-2 text-sm text-foreground"
            >
              <input
                type="checkbox"
                className="size-4 rounded border-border"
                checked={selected.includes(option)}
                onChange={(e) => {
                  const next = e.target.checked
                    ? [...selected, option]
                    : // Rebuilt from `options` order rather than push/splice, so
                      // the saved array does not reorder itself as boxes are
                      // toggled and produce a diff with no change in it.
                      selected.filter((v) => v !== option);
                  const ordered = options.filter((o) => next.includes(o));
                  // An empty selection is "no filter" for every consumer, and
                  // storing [] rather than dropping the key would read as a
                  // filter that matches nothing.
                  onValueChange(ordered.length > 0 ? ordered : undefined);
                }}
              />
              {option}
            </label>
          ))}
        </div>
      );
    }
    case "credential":
      // `field.credential` is set for every field resolved as kind
      // "credential" (config-schema.ts pairs it with the definition's
      // requirement), but the type is nullable, so fall back rather than
      // render a picker that cannot know what it accepts.
      return field.credential ? (
        <CredentialField
          requirement={field.credential}
          inputId={inputId}
          value={value}
          onValueChange={onValueChange}
          className={baseFieldClass()}
        />
      ) : (
        <input
          id={inputId}
          type="text"
          disabled
          className={baseFieldClass()}
          placeholder="No credential requirement declared for this field"
        />
      );
    case "kv-list":
    case "keyValueList":
      return (
        <ListFieldEditor
          field={field}
          inputId={inputId}
          value={value}
          onValueChange={onValueChange}
        />
      );
    case "fieldList":
      return (
        <FieldListEditor
          field={field}
          inputId={inputId}
          value={value}
          onValueChange={onValueChange}
        />
      );
  }
}

type KVRow = { id: number; key: string; value: string };

function toRows(
  field: ResolvedConfigField,
  value: FieldValue,
  nextId: () => number,
): KVRow[] {
  const mkRow = (key: unknown, raw: unknown): KVRow => ({
    id: nextId(),
    key: typeof key === "string" ? key : "",
    value: typeof raw === "string" ? raw : raw == null ? "" : String(raw),
  });
  if (field.kind === "kv-list") {
    const entries =
      value && typeof value === "object"
        ? Object.entries(value as Record<string, unknown>)
        : [];
    return entries.length > 0
      ? entries.map(([key, v]) => mkRow(key, v))
      : [mkRow("", "")];
  }
  if (!Array.isArray(value) || value.length === 0) {
    return [mkRow("", "")];
  }
  return value.map((item) => mkRow(item?.key, item?.value));
}

function fromRows(field: ResolvedConfigField, rows: KVRow[]): FieldValue {
  const present = rows.filter((row) => row.key.length > 0);
  if (field.kind === "kv-list") {
    const record: Record<string, string> = {};
    for (const row of present) record[row.key] = row.value;
    return record;
  }
  return present.map(({ key, value }) => ({ key, value }));
}

function ListFieldEditor({
  field,
  inputId,
  value,
  onValueChange,
}: {
  field: ResolvedConfigField;
  inputId: string;
  value: FieldValue;
  onValueChange: (next: FieldValue) => void;
}) {
  const idCounter = useRef(0);
  const [rows, setRows] = useState<KVRow[]>(() =>
    toRows(field, value, () => idCounter.current++),
  );

  const commit = useCallback(
    (next: KVRow[]) => {
      setRows(next);
      onValueChange(fromRows(field, next));
    },
    [field, onValueChange],
  );

  return (
    <fieldset className="flex flex-col gap-2" data-testid={inputId}>
      <legend className="sr-only">{field.label}</legend>
      {rows.map((row, index) => (
        <div
          key={row.id}
          className="grid grid-cols-[1fr_1fr_auto] items-center gap-1.5"
        >
          <input
            type="text"
            className={baseFieldClass()}
            aria-label={`${field.label} key ${index + 1}`}
            value={row.key}
            placeholder="Key"
            onChange={(e) => {
              const next = rows.map((r, i) =>
                i === index ? { ...r, key: e.target.value } : r,
              );
              commit(next);
            }}
          />
          <input
            type="text"
            className={baseFieldClass()}
            aria-label={`${field.label} value ${index + 1}`}
            value={row.value}
            placeholder="Value"
            onChange={(e) => {
              const next = rows.map((r, i) =>
                i === index ? { ...r, value: e.target.value } : r,
              );
              commit(next);
            }}
          />
          <button
            type="button"
            aria-label={`Remove ${field.label} row ${index + 1}`}
            className="rounded-md border border-border px-2 py-1 text-sm hover:bg-muted"
            onClick={() => commit(rows.filter((_, i) => i !== index))}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="w-fit rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
        onClick={() =>
          commit([...rows, { id: idCounter.current++, key: "", value: "" }])
        }
      >
        + Add {field.label.toLowerCase()} row
      </button>
    </fieldset>
  );
}

type FieldRow = { id: number; cells: Record<string, FieldValue> };

function toFieldRows(
  columns: ConfigListColumn[],
  value: FieldValue,
  nextId: () => number,
): FieldRow[] {
  const empty = (): FieldRow => ({ id: nextId(), cells: {} });
  if (!Array.isArray(value) || value.length === 0) {
    return [empty()];
  }
  return value.map((item) => {
    if (!item || typeof item !== "object") {
      return empty();
    }
    const cells: Record<string, FieldValue> = {};
    for (const column of columns) {
      const cell = (item as Record<string, FieldValue>)[column.key];
      if (cell !== undefined) cells[column.key] = cell;
    }
    return { id: nextId(), cells };
  });
}

function fieldRowPresent(row: FieldRow, columns: ConfigListColumn[]): boolean {
  return columns.some((column) => {
    const cell = row.cells[column.key];
    return typeof cell === "string"
      ? cell.length > 0
      : cell !== undefined && cell !== null;
  });
}

function rowCellEditor({
  column,
  value,
  ariaLabel,
  onValueChange,
}: {
  column: ConfigListColumn;
  value: FieldValue;
  ariaLabel: string;
  onValueChange: (next: FieldValue) => void;
}) {
  switch (column.kind) {
    case "multiline":
      return (
        <textarea
          rows={2}
          className={baseFieldClass()}
          aria-label={ariaLabel}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onValueChange(e.target.value)}
        />
      );
    case "number":
      return (
        <input
          type="number"
          className={baseFieldClass()}
          aria-label={ariaLabel}
          value={typeof value === "number" ? value : ""}
          onChange={(e) =>
            onValueChange(
              Number.isNaN(e.target.valueAsNumber)
                ? undefined
                : e.target.valueAsNumber,
            )
          }
        />
      );
    case "boolean":
      return (
        <input
          type="checkbox"
          className="size-4 rounded border-border"
          aria-label={ariaLabel}
          checked={Boolean(value)}
          onChange={(e) => onValueChange(e.target.checked)}
        />
      );
    case "enum": {
      const enumValues = column.enumValues ?? [];
      const hasValue = typeof value === "string" && enumValues.includes(value);
      return (
        <select
          className={baseFieldClass()}
          aria-label={ariaLabel}
          value={hasValue ? value : ""}
          onChange={(e) =>
            onValueChange(e.target.value === "" ? undefined : e.target.value)
          }
        >
          {!hasValue ? (
            <option value="">Select {column.label.toLowerCase()}…</option>
          ) : null}
          {enumValues.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );
    }
    default:
      return (
        <input
          type="text"
          className={baseFieldClass()}
          aria-label={ariaLabel}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onValueChange(e.target.value)}
        />
      );
  }
}

function FieldListEditor({
  field,
  inputId,
  value,
  onValueChange,
}: {
  field: ResolvedConfigField;
  inputId: string;
  value: FieldValue;
  onValueChange: (next: FieldValue) => void;
}) {
  const columns = field.columns ?? [];
  const idCounter = useRef(0);
  const [rows, setRows] = useState<FieldRow[]>(() =>
    toFieldRows(columns, value, () => idCounter.current++),
  );

  const commit = useCallback(
    (next: FieldRow[]) => {
      setRows(next);
      const present = next
        .filter((row) => fieldRowPresent(row, columns))
        .map((row) => ({ ...row.cells }));
      onValueChange(present);
    },
    [columns, onValueChange],
  );

  return (
    <fieldset className="flex flex-col gap-2" data-testid={inputId}>
      <legend className="sr-only">{field.label}</legend>
      {rows.map((row, index) => (
        <div
          key={row.id}
          className="flex flex-col gap-1 rounded-md border border-border p-2"
        >
          <div
            className="grid gap-1.5 items-start"
            style={{
              gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))`,
            }}
          >
            {columns.map((column) => (
              <div key={column.key} className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {column.label}
                </span>
                {rowCellEditor({
                  column,
                  value: row.cells[column.key],
                  ariaLabel: `${field.label} ${column.label} ${index + 1}`,
                  onValueChange: (next) => {
                    const changed = rows.map((r, i) =>
                      i === index
                        ? { ...r, cells: { ...r.cells, [column.key]: next } }
                        : r,
                    );
                    commit(changed);
                  },
                })}
              </div>
            ))}
          </div>
          <button
            type="button"
            aria-label={`Remove ${field.label} row ${index + 1}`}
            className="w-fit rounded-md border border-border px-2 py-0.5 text-xs hover:bg-muted"
            onClick={() => commit(rows.filter((_, i) => i !== index))}
          >
            Remove {field.label.toLowerCase()} row
          </button>
        </div>
      ))}
      <button
        type="button"
        className="w-fit rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
        onClick={() =>
          commit([...rows, { id: idCounter.current++, cells: {} }])
        }
      >
        + Add {field.label.toLowerCase()} row
      </button>
    </fieldset>
  );
}

export function NodeConfigForm({
  definition,
  data,
  onDataChange,
}: {
  definition: NodeDefinition;
  data: Record<string, unknown>;
  onDataChange: (next: Record<string, unknown>) => void;
}) {
  const uid = useId();

  const introspected = useMemo<
    { fields: ResolvedConfigField[] } | { error: UnsupportedConfigFieldError }
  >(() => {
    try {
      return {
        fields: resolveConfigFields(
          definition.configSchema,
          definition.credentials,
        ),
      };
    } catch (error) {
      return { error: error as UnsupportedConfigFieldError };
    }
  }, [definition]);

  if ("error" in introspected) {
    return (
      <div
        role="alert"
        className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
      >
        <p className="font-medium text-destructive">
          Some configuration fields could not be displayed.
        </p>
        <p className="mt-1 font-mono text-xs text-muted-foreground">
          {introspected.error.key}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {introspected.error.message}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {introspected.fields.map((field) => (
        <div key={field.key} className="flex flex-col gap-1.5">
          <label
            htmlFor={`${uid}-${field.key}`}
            className="text-xs font-medium"
          >
            {field.label}
            {field.optional ? (
              <span className="ml-1 text-muted-foreground">(optional)</span>
            ) : null}
          </label>
          <FieldEditor
            field={field}
            inputId={`${uid}-${field.key}`}
            value={data[field.key]}
            onValueChange={(next) =>
              onDataChange({ ...data, [field.key]: next })
            }
          />
        </div>
      ))}
    </div>
  );
}
