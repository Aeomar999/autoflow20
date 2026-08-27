import type { SearchParams } from "nuqs";
import { Suspense } from "react";
import { ErrorBoundary } from "react-error-boundary";
import {
  ExecutionsContainer,
  ExecutionsError,
  ExecutionsList,
  ExecutionsLoading,
} from "@/features/executions/components/executions";
import { executionsParamsLoader } from "@/features/executions/server/params-loader";
import { prefetchExecutions } from "@/features/executions/server/prefetch";
import { requireAuth } from "@/lib/auth-utils";
import { HydrateClient } from "@/trpc/server";

type Props = {
  searchParams: Promise<SearchParams>;
};

const Page = async ({ searchParams }: Props) => {
  await requireAuth();

  const params = await executionsParamsLoader(searchParams);
  await prefetchExecutions({
    ...params,
    status: (params.status || undefined) as
      | "RUNNING"
      | "SUCCESS"
      | "FAILED"
      | "CANCELLED"
      | "TIMED_OUT"
      | undefined,
  });

  return (
    <ExecutionsContainer>
      <HydrateClient>
        <ErrorBoundary fallback={<ExecutionsError />}>
          <Suspense fallback={<ExecutionsLoading />}>
            <ExecutionsList />
          </Suspense>
        </ErrorBoundary>
      </HydrateClient>
    </ExecutionsContainer>
  );
};

export default Page;
