import type { SearchParams } from "nuqs/server";
import { Suspense } from "react";
import { ErrorBoundary } from "react-error-boundary";
import {
  TemplatesContainer,
  TemplatesError,
  TemplatesGrid,
  TemplatesLoading,
} from "@/features/templates/components/templates";
import { templatesParamsLoader } from "@/features/templates/server/params-loader";
import { prefetchTemplates } from "@/features/templates/server/prefetch";
import { requireAuth } from "@/lib/auth-utils";
import { HydrateClient } from "@/trpc/server";

type Props = {
  searchParams: Promise<SearchParams>;
};

const Page = async ({ searchParams }: Props) => {
  await requireAuth();

  const params = await templatesParamsLoader(searchParams);
  await prefetchTemplates(params);

  return (
    <HydrateClient>
      <TemplatesContainer>
        <ErrorBoundary fallback={<TemplatesError />}>
          <Suspense fallback={<TemplatesLoading />}>
            <TemplatesGrid />
          </Suspense>
        </ErrorBoundary>
      </TemplatesContainer>
    </HydrateClient>
  );
};

export default Page;
