import type { SearchParams } from "nuqs";
import { Suspense } from "react";
import { ErrorBoundary } from "react-error-boundary";

import {
  EmployeesContainer,
  EmployeesError,
  EmployeesList,
  EmployeesLoading,
} from "@/features/employees/components/employees";
import type { EmployeeStatus } from "@/features/employees/lib/employee";
import { employeesParamsLoader } from "@/features/employees/server/params-loader";
import {
  prefetchEmployeeStatusCounts,
  prefetchEmployees,
} from "@/features/employees/server/prefetch";
import { requireAuth } from "@/lib/auth-utils";
import { HydrateClient } from "@/trpc/server";

type Props = {
  searchParams: Promise<SearchParams>;
};

const Page = async ({ searchParams }: Props) => {
  await requireAuth();

  const params = await employeesParamsLoader(searchParams);
  await Promise.all([
    prefetchEmployees({
      ...params,
      status: (params.status || undefined) as EmployeeStatus | undefined,
    }),
    prefetchEmployeeStatusCounts(),
  ]);

  return (
    <HydrateClient>
      <EmployeesContainer>
        <ErrorBoundary fallback={<EmployeesError />}>
          <Suspense fallback={<EmployeesLoading />}>
            <EmployeesList />
          </Suspense>
        </ErrorBoundary>
      </EmployeesContainer>
    </HydrateClient>
  );
};

export default Page;
