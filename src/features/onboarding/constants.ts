/**
 * First-run onboarding (AF-M7-05).
 *
 * v1 is deliberately schema-free: nothing about onboarding is persisted
 * server-side. Step completion is DERIVED from data the workspace already has
 * (does it own a workflow, a credential, an execution), and only the user's
 * "I've seen this / hide it" preference lives in `localStorage`. That way the
 * checklist cannot claim a step is done when the underlying thing was deleted,
 * and a user who clears their browser sees an accurate checklist rather than a
 * stale one.
 */

/** localStorage key. Versioned so a v2 shape cannot misread a v1 payload. */
export const ONBOARDING_STORAGE_KEY = "autoflow.onboarding.v1";

/**
 * The template "Create a sample workflow" installs.
 *
 * Chosen for what a first run should teach, not for what demos best: a manual
 * trigger the user can press themselves, a Set node showing how variables
 * flow, an AI node, and a delivery node — and zero required credentials, so
 * the install lands in the editor with nothing to configure first.
 *
 * `onboarding.test.ts` asserts this slug exists in the catalogue and is
 * credential-free, so retiring that template fails the build rather than
 * silently breaking the sample button.
 */
export const SAMPLE_TEMPLATE_SLUG = "content-brief-generator";

export type OnboardingStepId = "workflow" | "credential" | "run";

export interface OnboardingStep {
  id: OnboardingStepId;
  title: string;
  description: string;
}

export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: "workflow",
    title: "Create a workflow",
    description:
      "Start from a template or an empty canvas. Nothing is live until you deploy it.",
  },
  {
    id: "credential",
    title: "Connect a credential",
    description:
      "Encrypted per credential and decrypted only inside a running node — never returned to the browser.",
  },
  {
    id: "run",
    title: "Run a workflow",
    description:
      "Press Run in the editor. The execution and every node's input and output are recorded.",
  },
];
