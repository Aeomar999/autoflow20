"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { useTRPC } from "@/trpc/client";

import { SAMPLE_TEMPLATE_SLUG } from "../constants";
import {
  DEFAULT_PREFERENCE,
  type OnboardingPreference,
  type OnboardingState,
  resolveOnboardingState,
} from "../lib/state";
import {
  readOnboardingPreference,
  writeOnboardingPreference,
} from "../lib/storage";

/**
 * First-run checklist state (AF-M7-05).
 *
 * Returns `visible: false` until the status query resolves AND the stored
 * preference has been read on the client, so the card never flashes in and
 * back out on a workspace that has already dismissed it.
 */
export function useOnboarding(): OnboardingState & {
  isLoading: boolean;
  dismiss: () => void;
} {
  const trpc = useTRPC();
  const status = useQuery(trpc.onboarding.status.queryOptions());

  const [preference, setPreference] = useState<OnboardingPreference | null>(
    null,
  );
  const organizationId = status.data?.organizationId;

  // localStorage is client-only: reading during render would diverge from the
  // server-rendered markup and hydrate mismatched.
  useEffect(() => {
    if (!organizationId) return;
    setPreference(readOnboardingPreference(organizationId));
  }, [organizationId]);

  // Record that the checklist has been shown, so it survives the user
  // completing step 1 (which is what stops the org counting as first-run).
  useEffect(() => {
    if (!organizationId || !preference || preference.started) return;
    if (status.data && status.data.workflowCount > 0) return;
    const next = { ...preference, started: true };
    setPreference(next);
    writeOnboardingPreference(organizationId, next);
  }, [organizationId, preference, status.data]);

  const dismiss = useCallback(() => {
    if (!organizationId) return;
    const next = { ...(preference ?? DEFAULT_PREFERENCE), dismissed: true };
    setPreference(next);
    writeOnboardingPreference(organizationId, next);
  }, [organizationId, preference]);

  const isLoading = status.isPending || preference === null;

  const resolved = resolveOnboardingState(
    {
      workflowCount: status.data?.workflowCount ?? 0,
      credentialCount: status.data?.credentialCount ?? 0,
      executionCount: status.data?.executionCount ?? 0,
    },
    preference ?? DEFAULT_PREFERENCE,
  );

  return {
    ...resolved,
    visible: resolved.visible && !isLoading,
    isLoading,
    dismiss,
  };
}

/**
 * Install the sample workflow through the AF-M7-01 instantiate path — the same
 * one the gallery's Install button uses, so the sample cannot drift into a
 * second, differently-behaved code path.
 */
export function useCreateSampleWorkflow() {
  const trpc = useTRPC();
  const router = useRouter();
  const queryClient = useQueryClient();

  return useMutation(
    trpc.templates.instantiate.mutationOptions({
      onSuccess: (data) => {
        toast.success("Sample workflow installed as a draft");
        queryClient.invalidateQueries(trpc.onboarding.status.queryOptions());
        queryClient.invalidateQueries(trpc.workflows.getMany.queryOptions({}));
        router.push(`/workflows/${data.workflowId}`);
      },
      onError: (error) => {
        // Most likely cause is an unseeded database — say so, rather than
        // showing a raw tRPC message the user cannot act on.
        toast.error(
          error.message ||
            "Could not install the sample. Has the template gallery been seeded?",
        );
      },
    }),
  );
}

export { SAMPLE_TEMPLATE_SLUG };
