import { describe, expect, it } from "vitest";

import { templateCatalog, toSeedRow } from "@/features/templates/catalog";

import { ONBOARDING_STEPS, SAMPLE_TEMPLATE_SLUG } from "../constants";
import {
  DEFAULT_PREFERENCE,
  type OnboardingCounts,
  resolveOnboardingState,
} from "./state";

const EMPTY: OnboardingCounts = {
  workflowCount: 0,
  credentialCount: 0,
  executionCount: 0,
};

describe("resolveOnboardingState", () => {
  it("shows on a brand-new workspace", () => {
    expect(resolveOnboardingState(EMPTY, DEFAULT_PREFERENCE).visible).toBe(
      true,
    );
  });

  it("stays hidden for an established workspace that never saw it", () => {
    // Someone who has been using the product for months should not suddenly
    // be handed a first-run checklist because they deleted their last run.
    const established = { ...EMPTY, workflowCount: 3 };
    expect(
      resolveOnboardingState(established, DEFAULT_PREFERENCE).visible,
    ).toBe(false);
  });

  it("survives the user completing step one", () => {
    // The regression this guards: creating a workflow stops the org counting
    // as first-run, which would take the card away mid-checklist.
    const afterStepOne = { ...EMPTY, workflowCount: 1 };
    const started = { ...DEFAULT_PREFERENCE, started: true };
    const state = resolveOnboardingState(afterStepOne, started);

    expect(state.visible).toBe(true);
    expect(state.completedCount).toBe(1);
  });

  it("disappears on its own once every step is done", () => {
    const done: OnboardingCounts = {
      workflowCount: 1,
      credentialCount: 1,
      executionCount: 1,
    };
    const state = resolveOnboardingState(done, {
      ...DEFAULT_PREFERENCE,
      started: true,
    });

    expect(state.allComplete).toBe(true);
    expect(state.visible).toBe(false);
  });

  it("stays hidden once dismissed, even on a first run", () => {
    const state = resolveOnboardingState(EMPTY, {
      dismissed: true,
      started: true,
    });
    expect(state.visible).toBe(false);
  });

  it("derives each step from its own count", () => {
    const state = resolveOnboardingState(
      { workflowCount: 1, credentialCount: 0, executionCount: 2 },
      { ...DEFAULT_PREFERENCE, started: true },
    );

    expect(state.steps).toEqual([
      { id: "workflow", complete: true },
      { id: "credential", complete: false },
      { id: "run", complete: true },
    ]);
    expect(state.completedCount).toBe(2);
  });

  it("counts a failed run as a run", () => {
    // The step teaches the user what a run looks like; a red one still does.
    const state = resolveOnboardingState(
      { workflowCount: 1, credentialCount: 1, executionCount: 1 },
      { ...DEFAULT_PREFERENCE, started: true },
    );
    expect(state.steps.find((s) => s.id === "run")?.complete).toBe(true);
  });

  it("reports a step for every declared step", () => {
    const state = resolveOnboardingState(EMPTY, DEFAULT_PREFERENCE);
    expect(state.steps.map((s) => s.id)).toEqual(
      ONBOARDING_STEPS.map((s) => s.id),
    );
  });
});

describe("sample workflow template", () => {
  it("exists in the authored catalogue", () => {
    // Retiring the sample template breaks the checklist's primary button, so
    // fail here rather than at the user's first click.
    const sample = templateCatalog.find((t) => t.slug === SAMPLE_TEMPLATE_SLUG);
    expect(
      sample,
      `no template with slug "${SAMPLE_TEMPLATE_SLUG}"`,
    ).toBeDefined();
  });

  it("needs no credentials, so the install lands ready to look at", () => {
    const sample = templateCatalog.find((t) => t.slug === SAMPLE_TEMPLATE_SLUG);
    expect(sample && toSeedRow(sample).credentialCount).toBe(0);
  });

  it("starts from a manual trigger the user can press", () => {
    const sample = templateCatalog.find((t) => t.slug === SAMPLE_TEMPLATE_SLUG);
    expect(sample?.graph.nodes.some((n) => n.type === "MANUAL_TRIGGER")).toBe(
      true,
    );
  });
});
