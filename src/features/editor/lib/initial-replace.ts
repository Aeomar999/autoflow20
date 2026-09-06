/**
 * AF-UX-04 (`docs/ux-improvement-plan.md` §1.1): the canvas drop flow must
 * confirm before it replaces a fresh workflow's INITIAL placeholder trigger.
 *
 * Rule:
 *  - no trigger present on the canvas             -> "add"     (append the node)
 *  - INITIAL placeholder present, prompt dismissed -> "commit"  (replace silently)
 *  - INITIAL placeholder present, prompt not dismissed -> "confirm" (ask first)
 *
 * The dismissal flag lives in localStorage under `autoflow-editor-dismiss-initial-replace`
 * (same `autoflow-*` convention as `autoflow-theme`). Reads/writes are
 * SSR-guarded and isolated in try/catch: when storage is unavailable the
 * helpers degrade to "never dismissed", which makes the caller always show the
 * prompt. The safe default is to ask, never to skip silently.
 */

export const INITIAL_REPLACE_DISMISS_KEY =
  "autoflow-editor-dismiss-initial-replace";

export type InitialReplaceBehavior = "add" | "commit" | "confirm";

export function resolveInitialReplaceBehavior(
  hasInitialTrigger: boolean,
  dismissed: boolean,
): InitialReplaceBehavior {
  if (!hasInitialTrigger) return "add";
  return dismissed ? "commit" : "confirm";
}

export function isInitialReplaceDismissed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(INITIAL_REPLACE_DISMISS_KEY) === "1";
  } catch {
    // Storage unavailable (privacy mode, quota) — degrade to "always confirm".
    return false;
  }
}

export function setInitialReplaceDismissed(dismissed: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (dismissed) {
      window.localStorage.setItem(INITIAL_REPLACE_DISMISS_KEY, "1");
    } else {
      window.localStorage.removeItem(INITIAL_REPLACE_DISMISS_KEY);
    }
  } catch {
    // Storage unavailable — the flag simply will not persist; the prompt stays on.
  }
}
