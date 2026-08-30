import type { SearchParams } from "nuqs";
import { Suspense } from "react";
import { ErrorBoundary } from "react-error-boundary";
import {
  KnowledgeError,
  KnowledgeList,
  KnowledgeLoading,
} from "@/features/knowledge/components/knowledge-list";
import { knowledgeParamsLoader } from "@/features/knowledge/server/params-loader";
import { prefetchKnowledgeSources } from "@/features/knowledge/server/prefetch";
import { requireAuth } from "@/lib/auth-utils";
import { HydrateClient } from "@/trpc/server";

type Props = {
  searchParams: Promise<SearchParams>;
};

const Page = async ({ searchParams }: Props) => {
  await requireAuth();

  const params = await knowledgeParamsLoader(searchParams);
  prefetchKnowledgeSources(params);

  return (
    <HydrateClient>
      <ErrorBoundary fallback={<KnowledgeError />}>
        <Suspense fallback={<KnowledgeLoading />}>
          <KnowledgeList />
        </Suspense>
      </ErrorBoundary>
    </HydrateClient>
  );
};

export default Page;
