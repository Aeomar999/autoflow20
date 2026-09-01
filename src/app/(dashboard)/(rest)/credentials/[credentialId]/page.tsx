import { Suspense } from "react";
import { ErrorBoundary } from "react-error-boundary";
import {
  DashboardError,
  DashboardLoading,
  DashboardPage,
} from "@/components/dashboard/page";
import { CredentialView } from "@/features/credentials/components/credential";
import { prefetchCredential } from "@/features/credentials/server/prefetch";
import { requireAuth } from "@/lib/auth-utils";
import { HydrateClient } from "@/trpc/server";

interface PageProps {
  params: Promise<{
    credentialId: string;
  }>;
}

const Page = async ({ params }: PageProps) => {
  await requireAuth();

  const { credentialId } = await params;
  await prefetchCredential(credentialId);

  return (
    <DashboardPage>
      <HydrateClient>
        <ErrorBoundary
          fallback={<DashboardError message="Error loading credential" />}
        >
          <Suspense
            fallback={<DashboardLoading message="Loading credential..." />}
          >
            <CredentialView credentialId={credentialId} />
          </Suspense>
        </ErrorBoundary>
      </HydrateClient>
    </DashboardPage>
  );
};

export default Page;
