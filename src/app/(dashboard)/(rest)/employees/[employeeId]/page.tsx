import { Suspense } from "react";
import { ErrorBoundary } from "react-error-boundary";

import {
  DashboardError,
  DashboardLoading,
  DashboardPage,
} from "@/components/dashboard/page";
import { EmployeeView } from "@/features/employees/components/employee";
import { prefetchEmployee } from "@/features/employees/server/prefetch";
import { requireAuth } from "@/lib/auth-utils";
import { HydrateClient } from "@/trpc/server";

interface PageProps {
  params: Promise<{ employeeId: string }>;
}

const Page = async ({ params }: PageProps) => {
  await requireAuth();

  const { employeeId } = await params;
  await prefetchEmployee(employeeId);

  return (
    <DashboardPage>
      <HydrateClient>
        <ErrorBoundary
          fallback={<DashboardError message="Error loading employee" />}
        >
          <Suspense
            fallback={<DashboardLoading message="Loading employee..." />}
          >
            <EmployeeView employeeId={employeeId} />
          </Suspense>
        </ErrorBoundary>
      </HydrateClient>
    </DashboardPage>
  );
};

export default Page;
