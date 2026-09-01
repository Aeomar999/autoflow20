import { Suspense } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { DashboardError, DashboardPage } from "@/components/dashboard/page";
import TemplateDetail, {
  TemplateDetailSkeleton,
} from "@/features/templates/components/template-detail";
import { prefetchTemplate } from "@/features/templates/server/prefetch";
import { requireAuth } from "@/lib/auth-utils";
import { HydrateClient } from "@/trpc/server";

interface PageProps {
  params: Promise<{
    slug: string;
  }>;
}

const Page = async ({ params }: PageProps) => {
  await requireAuth();

  const { slug } = await params;
  await prefetchTemplate(slug);

  return (
    <HydrateClient>
      <DashboardPage>
        <ErrorBoundary
          fallback={<DashboardError message="Error loading template" />}
        >
          <Suspense fallback={<TemplateDetailSkeleton />}>
            <TemplateDetail slug={slug} />
          </Suspense>
        </ErrorBoundary>
      </DashboardPage>
    </HydrateClient>
  );
};

export default Page;
