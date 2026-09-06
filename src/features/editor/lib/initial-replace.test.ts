import { describe, expect, it } from "vitest";
import {
  INITIAL_REPLACE_DISMISS_KEY,
  isInitialReplaceDismissed,
  resolveInitialReplaceBehavior,
  setInitialReplaceDismissed,
} from "./initial-replace";

describe("resolveInitialReplaceBehavior", () => {
  it("returns 'add' when no trigger is present, regardless of the dismiss flag", () => {
    expect(resolveInitialReplaceBehavior(false, false)).toBe("add");
    expect(resolveInitialReplaceBehavior(false, true)).toBe("add");
  });

  it("returns 'confirm' when the INITIAL placeholder is present and not dismissed", () => {
    expect(resolveInitialReplaceBehavior(true, false)).toBe("confirm");
  });

  it("returns 'commit' when the INITIAL placeholder is present and dismissed", () => {
    expect(resolveInitialReplaceBehavior(true, true)).toBe("commit");
  });
});

describe("initial replace dismiss flag (SSR guard)", () => {
  // These run in the node environment where `window` is undefined; the guards
  // must not throw and must degrade to "always confirm".
  it("reads false when no window is available", () => {
    expect(isInitialReplaceDismissed()).toBe(false);
  });

  it("writing outside a browser is a no-op, not a throw", () => {
    expect(() => setInitialReplaceDismissed(true)).not.toThrow();
  });

  it("the key follows the autoflow-* convention", () => {
    expect(INITIAL_REPLACE_DISMISS_KEY).toBe(
      "autoflow-editor-dismiss-initial-replace",
    );
  });
});
