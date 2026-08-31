"use client";

import { parseAsInteger, useQueryState } from "nuqs";
import { DEFAULT_MONITORING_PERIOD_DAYS } from "../params";

export function useMonitoringParams() {
  const [days, setDays] = useQueryState(
    "days",
    parseAsInteger.withDefault(DEFAULT_MONITORING_PERIOD_DAYS),
  );

  return { days, setDays };
}
