import type { SearchParams } from "nuqs";
import { Suspense } from "react";
import { ErrorBoundary } from "react-error-boundary";
import {
  CostDashboard,
  CostsContainer,
  CostsError,
  CostsLoading,
} from "@/features/costs/components/cost-dashboard";
import { normalizeCostPeriodDays } from "@/features/costs/params";
import { costsParamsLoader } from "@/features/costs/server/params-loader";
import {
  prefetchCacheStats,
  prefetchCostSummary,
} from "@/features/costs/server/prefetch";
import { requireAuth } from "@/lib/auth-utils";
import { HydrateClient } from "@/trpc/server";

type Props = {
  searchParams: Promise<SearchParams>;
};

const Page = async ({ searchParams }: Props) => {
  await requireAuth();

  const { days: rawDays } = await costsParamsLoader(searchParams);
  const days = normalizeCostPeriodDays(rawDays);
  prefetchCostSummary(days);
  prefetchCacheStats(days);

  return (
    <HydrateClient>
      <CostsContainer>
        <ErrorBoundary fallback={<CostsError />}>
          <Suspense fallback={<CostsLoading />}>
            <CostDashboard />
          </Suspense>
        </ErrorBoundary>
      </CostsContainer>
    </HydrateClient>
  );
};

export default Page;
