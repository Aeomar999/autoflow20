/**
 * Aggregation helpers for the monitoring dashboard (AF-M7-03).
 *
 * Re-exports fillDailySeries and toIsoDay from the costs lib so the analytics
 * module doesn't reach into another feature's internals for shared utilities.
 * Analytics-specific shaping lives here.
 */

export {
  fillDailySeries,
  roundUsd,
  toIsoDay,
} from "@/features/costs/lib/aggregate";

import type { DailyStatusPoint } from "./types";

/** Status colors for the stacked chart (hand-rolled SVG). */
export const STATUS_COLORS: Record<string, string> = {
  SUCCESS: "#22c55e",
  FAILED: "#ef4444",
  CANCELLED: "#a3a3a3",
  TIMED_OUT: "#f59e0b",
  QUOTA_EXCEEDED: "#dc2626",
  RUNNING: "#3b82f6",
};

const STATUSES = [
  "SUCCESS",
  "FAILED",
  "CANCELLED",
  "TIMED_OUT",
  "QUOTA_EXCEEDED",
  "RUNNING",
] as const;

/**
 * Merge multiple per-day status counts into a zero-filled series where each
 * day has a key for every status. Input rows come from raw SQL grouped by
 * (day, status).
 */
export function buildStatusSeries(
  rows: readonly { day: Date; status: string; count: number }[],
  days: number,
  now: Date = new Date(),
): DailyStatusPoint[] {
  const byDay = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const key = row.day.toISOString().slice(0, 10);
    const statusMap = byDay.get(key) ?? new Map<string, number>();
    statusMap.set(row.status, row.count);
    byDay.set(key, statusMap);
  }

  const series: DailyStatusPoint[] = [];
  const endMs = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(endMs - offset * 86_400_000);
    const key = date.toISOString().slice(0, 10);
    const statusMap = byDay.get(key);
    const point: DailyStatusPoint = {
      date: key,
      SUCCESS: 0,
      FAILED: 0,
      CANCELLED: 0,
      TIMED_OUT: 0,
      QUOTA_EXCEEDED: 0,
      RUNNING: 0,
    };
    for (const s of STATUSES) {
      point[s] = statusMap?.get(s) ?? 0;
    }
    series.push(point);
  }

  return series;
}
