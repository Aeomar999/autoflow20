"use client";

import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";

/**
 * The plan badge must match what enforcement gates on. Enforcement reads
 * `organization.plan` (e.g. the execution quota gate), which the webhook
 * demotes the moment a subscription is cancelled. Polar's `customer.state()`
 * instead reports an active subscription until the billing period ends, so a
 * period-end cancel left the badge on "Pro plan" while the workspace was
 * already Free. Sourcing it from `organizations.list` keeps UI and gate in
 * lockstep, and reuses the query the Workspace card already fetches.
 */
export const useSubscription = () => {
  const trpc = useTRPC();
  return useQuery(trpc.organizations.list.queryOptions());
};

export const useHasActiveSubscription = () => {
  const { data: organizations, isLoading, ...rest } = useSubscription();

  const hasActiveSubscription = (organizations?.[0]?.plan ?? "FREE") !== "FREE";

  return {
    hasActiveSubscription,
    isLoading,
    ...rest,
  };
};
