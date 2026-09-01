import { Suspense } from "react";
import { ErrorBoundary } from "react-error-boundary";
import {
  DashboardError,
  DashboardLoading,
  DashboardPage,
} from "@/components/dashboard/page";
import { ExecutionView } from "@/features/executions/components/execution";
import { prefetchExecution } from "@/features/executions/server/prefetch";
import { requireAuth } from "@/lib/auth-utils";
import { HydrateClient } from "@/trpc/server";

interface PageProps {
  params: Promise<{
    executionId: string;
  }>;
}

const Page = async ({ params }: PageProps) => {
  await requireAuth();

  const { executionId } = await params;
  await prefetchExecution(executionId);

  return (
    <DashboardPage>
      <HydrateClient>
        <ErrorBoundary
          fallback={<DashboardError message="Error loading this run" />}
        >
          <Suspense fallback={<DashboardLoading message="Loading run..." />}>
            <ExecutionView executionId={executionId} />
          </Suspense>
        </ErrorBoundary>
      </HydrateClient>
    </DashboardPage>
  );
};

export default Page;
