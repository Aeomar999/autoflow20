import type { SearchParams } from "nuqs/server";
import { Suspense } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { FirstRunChecklist } from "@/features/onboarding/components/first-run-checklist";
import { prefetchOnboardingStatus } from "@/features/onboarding/server/prefetch";
import {
  WorkflowsContainer,
  WorkflowsError,
  WorkflowsList,
  WorkflowsLoading,
} from "@/features/workflows/components/workflows";
import { workflowsParamsLoader } from "@/features/workflows/server/params-loader";
import { prefetchWorkflows } from "@/features/workflows/server/prefetch";
import { requireAuth } from "@/lib/auth-utils";
import { HydrateClient } from "@/trpc/server";

type Props = {
  searchParams: Promise<SearchParams>;
};

const Page = async ({ searchParams }: Props) => {
  await requireAuth();

  const params = await workflowsParamsLoader(searchParams);
  await Promise.all([prefetchWorkflows(params), prefetchOnboardingStatus()]);

  return (
    <HydrateClient>
      <WorkflowsContainer>
        <FirstRunChecklist />
        <ErrorBoundary fallback={<WorkflowsError />}>
          <Suspense fallback={<WorkflowsLoading />}>
            <WorkflowsList />
          </Suspense>
        </ErrorBoundary>
      </WorkflowsContainer>
    </HydrateClient>
  );
};

export default Page;
