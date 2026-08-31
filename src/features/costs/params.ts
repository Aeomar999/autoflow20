import { parseAsInteger } from "nuqs/server";

/** Rolling window for the cost views (AF-M5-08). */
export const COST_PERIOD_DAYS = [7, 30, 90] as const;
export const DEFAULT_COST_PERIOD_DAYS = 30;

export const costsParams = {
  days: parseAsInteger
    .withDefault(DEFAULT_COST_PERIOD_DAYS)
    .withOptions({ clearOnDefault: true }),
};

/**
 * `?days=` comes from the URL, so it is whatever someone typed. Anything
 * outside the range the router accepts falls back to the default rather than
 * failing the server prefetch with a validation error on a hand-edited URL.
 */
export function normalizeCostPeriodDays(raw: number): number {
  if (!Number.isInteger(raw) || raw < 1 || raw > 90) {
    return DEFAULT_COST_PERIOD_DAYS;
  }
  return raw;
}
