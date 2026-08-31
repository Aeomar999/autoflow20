import { prefetch, trpc } from "@/trpc/server";

/**
 * Prefetch the first-run checklist counts so the workflows page does not
 * render its list and then push a checklist card in above it.
 */
export const prefetchOnboardingStatus = () => {
  return prefetch(trpc.onboarding.status.queryOptions());
};
