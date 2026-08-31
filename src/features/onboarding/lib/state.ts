import { ONBOARDING_STEPS, type OnboardingStepId } from "../constants";

/**
 * Pure onboarding state (AF-M7-05) — no React, no storage, no network, so the
 * visibility rule is unit-testable on its own.
 */

/** Counts the workspace already has. Org-scoped by `onboarding.status`. */
export interface OnboardingCounts {
  workflowCount: number;
  credentialCount: number;
  executionCount: number;
}

/** What `onboarding.status` returns: the counts plus the workspace they describe. */
export interface OnboardingStatus extends OnboardingCounts {
  organizationId: string;
}

/** The only thing that is persisted, and only client-side. */
export interface OnboardingPreference {
  /** The user pressed "Hide". Never re-shown for this org. */
  dismissed: boolean;
  /**
   * The checklist has rendered at least once for this org.
   *
   * This is what keeps the card alive after step 1. The trigger is "the org
   * has no workflows", but creating a workflow satisfies that trigger — so
   * without this flag the checklist would vanish the moment the user did the
   * first thing it asked for, taking steps 2 and 3 with it.
   */
  started: boolean;
}

export const DEFAULT_PREFERENCE: OnboardingPreference = {
  dismissed: false,
  started: false,
};

export interface OnboardingState {
  visible: boolean;
  steps: Array<{ id: OnboardingStepId; complete: boolean }>;
  completedCount: number;
  allComplete: boolean;
}

/**
 * Whether a step is done, derived from workspace data rather than stored.
 *
 * "Run a workflow" keys off executions of any status: a run that failed still
 * taught the user what a run looks like, which is what the step is for.
 */
function isStepComplete(
  id: OnboardingStepId,
  counts: OnboardingCounts,
): boolean {
  switch (id) {
    case "workflow":
      return counts.workflowCount > 0;
    case "credential":
      return counts.credentialCount > 0;
    case "run":
      return counts.executionCount > 0;
  }
}

export function resolveOnboardingState(
  counts: OnboardingCounts,
  preference: OnboardingPreference,
): OnboardingState {
  const steps = ONBOARDING_STEPS.map((step) => ({
    id: step.id,
    complete: isStepComplete(step.id, counts),
  }));
  const completedCount = steps.filter((step) => step.complete).length;
  const allComplete = completedCount === steps.length;

  const isFirstRun = counts.workflowCount === 0;

  return {
    // Finished work disappears on its own: a workspace that has done all three
    // never sees the card again, with no dismissal needed and nothing stored.
    visible:
      !preference.dismissed &&
      !allComplete &&
      (isFirstRun || preference.started),
    steps,
    completedCount,
    allComplete,
  };
}
