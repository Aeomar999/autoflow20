import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  INITIAL_REPLACE_DISMISS_KEY,
  isInitialReplaceDismissed,
  resolveInitialReplaceBehavior,
} from "../lib/initial-replace";
import { InitialTriggerReplaceDialog } from "./initial-trigger-replace-dialog";

const onConfirm = vi.fn();
const onCancel = vi.fn();

const renderDialog = (open: boolean, nodeName = "Send Email") =>
  render(
    <InitialTriggerReplaceDialog
      open={open}
      nodeName={nodeName}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
  );

beforeEach(() => {
  onConfirm.mockClear();
  onCancel.mockClear();
  window.localStorage.clear();
});

describe("InitialTriggerReplaceDialog", () => {
  it("renders nothing while closed", () => {
    const { container } = renderDialog(false);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the dropped node name and the warning copy when open", () => {
    renderDialog(true, "Send Email");
    expect(
      screen.getByRole("heading", { name: "Replace the placeholder trigger?" }),
    ).toBeTruthy();
    expect(screen.getByText(/replaces the placeholder/).textContent).toContain(
      "Send Email",
    );
    expect(screen.getByText("Start")).toBeTruthy();
    expect(
      screen.getByText(/will not run until you add another trigger/),
    ).toBeTruthy();
  });

  it("confirms via the Replace button without persisting the dismiss flag", () => {
    renderDialog(true);
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(INITIAL_REPLACE_DISMISS_KEY)).toBeNull();
  });

  it("cancels via the Cancel button and never calls onConfirm", () => {
    renderDialog(true);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("cancels when the dialog is closed over the overlay (Escape counts too)", () => {
    renderDialog(true);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("does not dismiss via the overlay — an AlertDialog forces an explicit choice", async () => {
    // Radix registers its pointerdown-outside listener behind a 0ms timer
    // (DismissableLayer), so flush the event loop before dispatching.
    renderDialog(true);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const overlay = document.querySelector(
      '[data-slot="alert-dialog-overlay"]',
    );
    expect(overlay).not.toBeNull();
    overlay?.dispatchEvent(
      new window.PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        composed: true,
        button: 0,
      }),
    );
    // AlertDialog semantics: the overlay click alone must NOT resolve the
    // prompt — the user decides via Cancel/Replace (or Escape). Pins the
    // guard-rail so a future dismiss-on-overlay regression fails loudly.
    expect(onCancel).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("persists 'Don't show again' when the checkbox is checked and Replace is pressed", () => {
    renderDialog(true);
    fireEvent.click(screen.getByLabelText("Don’t show this again"));
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(INITIAL_REPLACE_DISMISS_KEY)).toBe("1");
    expect(isInitialReplaceDismissed()).toBe(true);
  });
});

describe("editor-side skip flag integration (jsdom)", () => {
  it("resolves a dismissed drop to 'commit' (silent replacement)", () => {
    window.localStorage.setItem(INITIAL_REPLACE_DISMISS_KEY, "1");
    expect(
      resolveInitialReplaceBehavior(true, isInitialReplaceDismissed()),
    ).toBe("commit");
  });

  it("resolves an undismissed drop on a seeded canvas to 'confirm'", () => {
    window.localStorage.removeItem(INITIAL_REPLACE_DISMISS_KEY);
    expect(
      resolveInitialReplaceBehavior(true, isInitialReplaceDismissed()),
    ).toBe("confirm");
  });
});
