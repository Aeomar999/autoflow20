import { parseAsInteger } from "nuqs/server";

/** Rolling window for the monitoring dashboard (AF-M7-03). */
export const MONITORING_PERIOD_DAYS = [7, 14, 30] as const;
export const DEFAULT_MONITORING_PERIOD_DAYS = 30;

export const monitoringParams = {
  days: parseAsInteger
    .withDefault(DEFAULT_MONITORING_PERIOD_DAYS)
    .withOptions({ clearOnDefault: true }),
};

/**
 * `?days=` comes from the URL, so it is whatever someone typed. Anything
 * outside the range the router accepts falls back to the default rather than
 * failing the server prefetch with a validation error on a hand-edited URL.
 */
export function normalizeMonitoringDays(raw: number): number {
  if (!Number.isInteger(raw) || raw < 1 || raw > 90) {
    return DEFAULT_MONITORING_PERIOD_DAYS;
  }
  return raw;
}
