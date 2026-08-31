/**
 * Display formatting for the monitoring dashboard (AF-M7-03).
 *
 * `formatDayLabel` is re-exported from the costs feature rather than
 * re-implemented: the two dashboards sit next to each other in the nav and a
 * date that reads "Aug 30" on one page and "08-30" on the other is a bug the
 * user experiences even if neither page is wrong on its own.
 */

export { formatDayLabel, formatPercent } from "@/features/costs/lib/format";

/**
 * A duration in milliseconds, at a precision that stays readable across the
 * four orders of magnitude a step can take (a 12ms Set node, a 90s LLM call).
 *
 * `null` means "nothing completed in this window", not "zero" — the caller
 * renders an em dash and explains it, rather than printing "0ms" and implying
 * an impossibly fast run.
 */
export function formatDuration(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

/** Whole counts with thousands separators, for stat cards and axis ticks. */
export function formatCount(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return Math.round(value).toLocaleString();
}

/** `1` → "1 run", `4` → "4 runs". */
export function pluralize(
  count: number,
  singular: string,
  plural = `${singular}s`,
): string {
  return `${formatCount(count)} ${count === 1 ? singular : plural}`;
}
