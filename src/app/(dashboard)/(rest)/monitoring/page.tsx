import type { SearchParams } from "nuqs";
import { Suspense } from "react";
import { ErrorBoundary } from "react-error-boundary";
import {
  MonitoringContainer,
  MonitoringDashboard,
  MonitoringError,
  MonitoringLoading,
} from "@/features/analytics/components/monitoring-dashboard";
import { normalizeMonitoringDays } from "@/features/analytics/params";
import { monitoringParamsLoader } from "@/features/analytics/server/params-loader";
import { prefetchMonitoringOverview } from "@/features/analytics/server/prefetch";
import { requireAuth } from "@/lib/auth-utils";
import { HydrateClient } from "@/trpc/server";

type Props = {
  searchParams: Promise<SearchParams>;
};

const Page = async ({ searchParams }: Props) => {
  await requireAuth();

  const { days: rawDays } = await monitoringParamsLoader(searchParams);
  const days = normalizeMonitoringDays(rawDays);
  prefetchMonitoringOverview(days);

  return (
    <HydrateClient>
      {/* The container renders the header (and its range control) outside the
          Suspense boundary, so switching the window keeps the page frame
          stable instead of collapsing the whole view into the fallback. */}
      <MonitoringContainer>
        <ErrorBoundary fallback={<MonitoringError />}>
          <Suspense fallback={<MonitoringLoading />}>
            <MonitoringDashboard />
          </Suspense>
        </ErrorBoundary>
      </MonitoringContainer>
    </HydrateClient>
  );
};

export default Page;
