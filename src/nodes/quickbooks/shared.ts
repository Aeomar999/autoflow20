import { NonRetriableError } from "inngest";

/**
 * Shared config vocabulary for the QuickBooks nodes (AF-M10-16).
 *
 * Isomorphic: definitions import from here and run on the client, so nothing
 * here may reach a server-only module — which is why the entity map comes
 * from `entity-names.ts` and the line shape is declared here rather than
 * imported from `server/entities.ts`.
 */

/** One line on an invoice, estimate or sales receipt. */
export interface QboLineInput {
  description?: string;
  amount: number;
  quantity?: number;
  unitPrice?: number;
  /** QBO Item id. */
  itemId?: string;
}

export const QBO_CREDENTIAL_TYPE = "intuit.oauth2";

export const QBO_LOGO = "/logos/quickbooks.png";

/**
 * Parse a resolved amount expression.
 *
 * Amounts reaching a node have usually been through a spreadsheet or another
 * API, and arrive as `"$1,299.00"` or `"1 299,00"` rather than as a number.
 * `Number("$1,299.00")` is `NaN`, which QuickBooks rejects with a message
 * about the whole document rather than about this field — so the coercion
 * happens here, where the error can name what is actually wrong.
 */
export function parseQboAmount(rendered: string, where: string): number {
  const amount = toNumber(rendered);
  if (amount === undefined) {
    throw new NonRetriableError(
      `${where}: "${rendered.trim().slice(0, 60)}" is not an amount. Check the expression that produces it — a blank source cell resolves to an empty string, not to zero.`,
    );
  }
  return amount;
}

/**
 * Parse a resolved lines expression into QBO line inputs.
 *
 * Lines arrive as a JSON template — `{{{json order.items}}}` — because the
 * shape is a list of objects and a key/value panel cannot express one. That
 * makes the two-brace mistake the most likely authoring error by a wide
 * margin, so it gets its own message rather than a JSON parse error.
 */
export function parseQboLines(rendered: string, where: string): QboLineInput[] {
  const trimmed = rendered.trim();
  if (trimmed.length === 0) {
    throw new NonRetriableError(
      `${where}: the lines expression resolved to nothing. A document with no lines is never what was meant.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new NonRetriableError(
      `${where}: the lines expression did not resolve to JSON. Use three braces — {{{json order.items}}} — rather than two, which HTML-escapes the quotes.`,
    );
  }

  const rows = Array.isArray(parsed) ? parsed : [parsed];

  return rows.map((row, index) => {
    if (!row || typeof row !== "object") {
      throw new NonRetriableError(
        `${where}: line ${index + 1} is not an object. Each line needs at least an amount.`,
      );
    }

    const record = row as Record<string, unknown>;
    const amount = toNumber(record.amount ?? record.Amount);

    if (amount === undefined) {
      throw new NonRetriableError(
        `${where}: line ${index + 1} has no amount. Every line needs one, and a blank source cell resolves to an empty string rather than to zero.`,
      );
    }

    return {
      amount,
      description: toText(record.description ?? record.Description),
      quantity: toNumber(record.quantity ?? record.Qty),
      unitPrice: toNumber(record.unitPrice ?? record.UnitPrice),
      itemId: toText(record.itemId ?? record.ItemId),
    };
  });
}

/**
 * Numbers arriving from a sheet or an API are often strings, and often
 * carry a currency symbol or thousands separators. `Number("$1,299.00")` is
 * `NaN`, which would post a line QBO rejects with a message about the whole
 * document rather than about this cell.
 */
function toNumber(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value !== "string") return undefined;

  const cleaned = value.replace(/[^0-9.-]/g, "");
  if (cleaned.length === 0) return undefined;

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toText(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  if (typeof value === "number") return String(value);
  return undefined;
}
