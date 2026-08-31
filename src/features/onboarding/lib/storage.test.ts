import { afterEach, describe, expect, it, vi } from "vitest";

import { ONBOARDING_STORAGE_KEY } from "../constants";
import { DEFAULT_PREFERENCE } from "./state";
import { readOnboardingPreference, writeOnboardingPreference } from "./storage";

/**
 * These run in the `unit` (node) project, which has no `window`. Each test
 * installs the storage shape it needs, so the failure modes — absent, hostile,
 * throwing — are all reachable.
 */
function installStorage(store: Record<string, string> = {}): void {
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
    },
  });
}

function installThrowingStorage(): void {
  vi.stubGlobal("window", {
    localStorage: {
      getItem: () => {
        throw new Error("SecurityError: site data blocked");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("onboarding preference storage", () => {
  it("round-trips a preference", () => {
    installStorage();
    writeOnboardingPreference("org_a", { dismissed: true, started: true });
    expect(readOnboardingPreference("org_a")).toEqual({
      dismissed: true,
      started: true,
    });
  });

  it("keeps workspaces independent", () => {
    // Hiding the checklist in one workspace must not hide it in another that
    // genuinely is on its first run.
    installStorage();
    writeOnboardingPreference("org_a", { dismissed: true, started: true });
    expect(readOnboardingPreference("org_b")).toEqual(DEFAULT_PREFERENCE);
  });

  it("defaults when nothing is stored", () => {
    installStorage();
    expect(readOnboardingPreference("org_a")).toEqual(DEFAULT_PREFERENCE);
  });

  it("defaults on unparseable JSON rather than throwing", () => {
    installStorage({ [ONBOARDING_STORAGE_KEY]: "{not json" });
    expect(readOnboardingPreference("org_a")).toEqual(DEFAULT_PREFERENCE);
  });

  it("defaults when the stored value is the wrong shape", () => {
    installStorage({ [ONBOARDING_STORAGE_KEY]: '["dismissed"]' });
    expect(readOnboardingPreference("org_a")).toEqual(DEFAULT_PREFERENCE);
  });

  it("coerces non-boolean flags rather than trusting them", () => {
    installStorage({
      [ONBOARDING_STORAGE_KEY]: '{"org_a":{"dismissed":"yes","started":1}}',
    });
    expect(readOnboardingPreference("org_a")).toEqual(DEFAULT_PREFERENCE);
  });

  it("survives storage that throws on read", () => {
    // Safari private mode and blocked site data both throw on access. Showing
    // a hint card is the harmless direction to fail.
    installThrowingStorage();
    expect(readOnboardingPreference("org_a")).toEqual(DEFAULT_PREFERENCE);
  });

  it("survives storage that throws on write", () => {
    installThrowingStorage();
    expect(() =>
      writeOnboardingPreference("org_a", { dismissed: true, started: true }),
    ).not.toThrow();
  });
});
