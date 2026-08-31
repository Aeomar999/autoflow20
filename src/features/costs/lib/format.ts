/**
 * Display formatting for the cost views (AF-M5-08).
 *
 * Aggregates span six orders of magnitude — a single cached run costs
 * $0.000075 while a month of production is $412.90 — so one fixed precision
 * would either round real spend to $0.00 or bury a dashboard in zeros.
 */

/** Dollar amount at a precision that keeps small sums visible. */
export function formatUsd(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "$0.00";
  if (value < 0.0001) return "< $0.0001";
  if (value < 1) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

/** Compact token counts: 1_234_567 → "1.2M". */
export function formatTokens(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value < 1_000) return String(Math.round(value));
  if (value < 1_000_000) return `${(value / 1_000).toFixed(1)}K`;
  return `${(value / 1_000_000).toFixed(1)}M`;
}

/** Fraction (0–1) as a whole-percent string. */
export function formatPercent(fraction: number): string {
  if (!Number.isFinite(fraction) || fraction <= 0) return "0%";
  return `${Math.round(fraction * 100)}%`;
}

/** `2026-08-30` → `Aug 30`, for chart axes. */
export function formatDayLabel(isoDay: string): string {
  const parsed = new Date(`${isoDay}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return isoDay;
  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
