"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { normalizeMonitoringDays } from "../params";
import { useMonitoringParams } from "./use-monitoring-params";

export const useSuspenseMonitoringOverview = () => {
  const trpc = useTRPC();
  const { days } = useMonitoringParams();

  return useSuspenseQuery(
    trpc.analytics.overview.queryOptions({
      days: normalizeMonitoringDays(days),
    }),
  );
};
