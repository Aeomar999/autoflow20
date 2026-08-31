import { ONBOARDING_STORAGE_KEY } from "../constants";
import { DEFAULT_PREFERENCE, type OnboardingPreference } from "./state";

/**
 * localStorage persistence for the onboarding preference (AF-M7-05).
 *
 * Keyed per organization: switching workspaces must not carry one workspace's
 * "hidden" state into another that genuinely is on its first run.
 *
 * Every access is wrapped. `localStorage` throws outright in Safari private
 * mode and wherever site data is blocked, and this is a dismissible hint card
 * — it must never be the reason a page fails to render. On any failure we fall
 * back to the default preference, which shows the card: over-showing a hint is
 * the harmless direction to fail.
 */

type StoredShape = Record<string, Partial<OnboardingPreference>>;

function readAll(): StoredShape {
  try {
    const raw = window.localStorage.getItem(ONBOARDING_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      return {};
    }
    return parsed as StoredShape;
  } catch {
    return {};
  }
}

export function readOnboardingPreference(
  organizationId: string,
): OnboardingPreference {
  const stored = readAll()[organizationId];
  if (!stored) return DEFAULT_PREFERENCE;
  return {
    dismissed: stored.dismissed === true,
    started: stored.started === true,
  };
}

export function writeOnboardingPreference(
  organizationId: string,
  preference: OnboardingPreference,
): void {
  try {
    const all = readAll();
    all[organizationId] = preference;
    window.localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Storage unavailable or full. The card stays visible for this session,
    // which is the correct degradation for a dismissible hint.
  }
}
