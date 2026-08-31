/**
 * Pure aggregation helpers for the cost views (AF-M5-08).
 *
 * Everything here is IO-free so the shaping rules — zero-filled days, UTC day
 * keys, micro-dollar rounding — are unit-tested without a database.
 */

export interface DailyCostRow {
  day: Date;
  costUsd: number;
  runs: number;
  tokensIn: number;
  tokensOut: number;
}

export interface DailyCostPoint {
  /** UTC calendar day, `YYYY-MM-DD`. */
  date: string;
  costUsd: number;
  runs: number;
  tokensIn: number;
  tokensOut: number;
}

/** Money is stored and compared at micro-dollar precision. */
export function roundUsd(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 1e6) / 1e6;
}

/** UTC calendar day key. Reports are UTC-based; the UI says so. */
export function toIsoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Expands sparse per-day totals into one point per day in the window, oldest
 * first. Days with no runs are real zeros, not gaps — a chart that skips them
 * would imply spend continued between two distant points.
 */
export function fillDailySeries(
  rows: readonly DailyCostRow[],
  days: number,
  now: Date = new Date(),
): DailyCostPoint[] {
  const byDay = new Map<string, DailyCostRow>();
  for (const row of rows) {
    byDay.set(toIsoDay(row.day), row);
  }

  const series: DailyCostPoint[] = [];
  const endMs = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(endMs - offset * 86_400_000);
    const key = toIsoDay(date);
    const row = byDay.get(key);
    series.push({
      date: key,
      costUsd: roundUsd(row?.costUsd ?? 0),
      runs: row?.runs ?? 0,
      tokensIn: row?.tokensIn ?? 0,
      tokensOut: row?.tokensOut ?? 0,
    });
  }

  return series;
}

/** Fraction of a total, clamped to [0,1]; 0 when the total is 0. */
export function shareOfTotal(part: number, total: number): number {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) {
    return 0;
  }
  return Math.min(1, Math.max(0, part / total));
}
