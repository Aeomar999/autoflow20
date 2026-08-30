import type { inferInput } from "@trpc/tanstack-react-query";
import { prefetch, trpc } from "@/trpc/server";

type Input = inferInput<typeof trpc.knowledge.list>;

export const prefetchKnowledgeSources = (params: Input) => {
  return prefetch(trpc.knowledge.list.queryOptions(params));
};
