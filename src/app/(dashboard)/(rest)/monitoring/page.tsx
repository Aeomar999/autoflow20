import type { SearchParams } from "nuqs";
import { Suspense } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { MonitoringDashboard } from "@/features/analytics/components/monitoring-dashboard";
import { normalizeMonitoringDays } from "@/features/analytics/params";
import { monitoringParamsLoader } from "@/features/analytics/server/params-loader";
import { prefetchMonitoringOverview } from "@/features/analytics/server/prefetch";
import { requireAuth } from "@/lib/auth-utils";
import { HydrateClient } from "@/trpc/server";

type Props = {
  searchParams: Promise<SearchParams>;
};

function MonitoringError() {
  return (
    <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-6 text-center">
      <p className="text-sm text-destructive">
        Failed to load monitoring data. Please try again.
      </p>
    </div>
  );
}

function MonitoringLoading() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Monitoring</h1>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {["total", "success", "avg", "p50", "p95"].map((card) => (
          <div key={card} className="rounded-lg border bg-card p-4">
            <div className="h-4 w-20 animate-pulse rounded bg-muted" />
            <div className="mt-2 h-8 w-16 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-lg border bg-card" />
    </div>
  );
}

const Page = async ({ searchParams }: Props) => {
  await requireAuth();

  const { days: rawDays } = await monitoringParamsLoader(searchParams);
  const days = normalizeMonitoringDays(rawDays);
  prefetchMonitoringOverview(days);

  return (
    <HydrateClient>
      <ErrorBoundary fallback={<MonitoringError />}>
        <Suspense fallback={<MonitoringLoading />}>
          <MonitoringDashboard />
        </Suspense>
      </ErrorBoundary>
    </HydrateClient>
  );
};

export default Page;
