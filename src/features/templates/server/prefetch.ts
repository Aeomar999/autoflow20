import type { inferInput } from "@trpc/tanstack-react-query";
import { prefetch, trpc } from "@/trpc/server";

type Input = inferInput<typeof trpc.templates.list>;

/**
 * Prefetch the template gallery
 */
export const prefetchTemplates = (params: Input) => {
  return prefetch(trpc.templates.list.queryOptions(params));
};

/**
 * Prefetch a single template
 */
export const prefetchTemplate = (slug: string) => {
  return prefetch(trpc.templates.getOne.queryOptions({ slug }));
};
