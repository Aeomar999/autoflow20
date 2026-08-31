import { Suspense } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { ErrorView } from "@/components/entity-components";
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
      <div className="p-4 md:px-10 md:py-6 h-full">
        <ErrorBoundary
          fallback={<ErrorView message="Error loading template" />}
        >
          <Suspense fallback={<TemplateDetailSkeleton />}>
            <TemplateDetail slug={slug} />
          </Suspense>
        </ErrorBoundary>
      </div>
    </HydrateClient>
  );
};

export default Page;
