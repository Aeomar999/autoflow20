"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { setInitialReplaceDismissed } from "../lib/initial-replace";

interface InitialTriggerReplaceDialogProps {
  /** Name of the node being dropped, shown in the warning copy. */
  nodeName: string;
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * AF-UX-04 (`docs/ux-improvement-plan.md` §1.1): confirm before the canvas
 * drop flow replaces a fresh workflow's INITIAL placeholder trigger.
 *
 * Rendered by the editor when a drop lands on a canvas that still holds the
 * seed "Start" node. Cancel (button or Escape) aborts the drop entirely — the
 * placeholder graph is left untouched; the overlay click does not resolve the
 * prompt because an alert demands an explicit choice. "Don't show this again"
 * persists under `autoflow-editor-dismiss-initial-replace` so power users can
 * skip the prompt; the editor then silently commits the replacement on
 * subsequent drops.
 */
export function InitialTriggerReplaceDialog({
  nodeName,
  open,
  onConfirm,
  onCancel,
}: InitialTriggerReplaceDialogProps) {
  const [dismissChecked, setDismissChecked] = useState(false);
  // Radix AlertDialog auto-closes after Action/Cancel fire their onClick, which
  // re-enters onOpenChange(false). We must not turn the close that follows a
  // confirmed Replace into a cancel; the ref tells the close handler apart.
  const confirmedRef = useRef(false);

  // A new drop is a fresh decision. The persisted flag still applies (the
  // editor reads it when the dialog is skipped), but the in-dialog checkbox
  // resets so re-opening never carries stale state.
  useEffect(() => {
    if (open) setDismissChecked(false);
  }, [open]);

  const confirm = () => {
    setInitialReplaceDismissed(dismissChecked);
    confirmedRef.current = true;
    onConfirm();
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          confirmedRef.current = false;
          return;
        }
        // Escaping through here after the dialog's own close-on-Replace is a
        // no-op; any other close (Cancel, Escape, overlay) is an abort.
        if (!confirmedRef.current) onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Replace the placeholder trigger?</AlertDialogTitle>
          <AlertDialogDescription>
            <div className="space-y-3">
              <p>
                Adding &ldquo;{nodeName}&rdquo; replaces the placeholder{" "}
                <strong>Start</strong> node. This workflow will not run until
                you add another trigger — make sure the node you dropped is the
                one you want to start the workflow.
              </p>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="initial-replace-dismiss"
                  checked={dismissChecked}
                  onCheckedChange={(checked) =>
                    setDismissChecked(checked === true)
                  }
                />
                <Label
                  htmlFor="initial-replace-dismiss"
                  className="cursor-pointer text-sm font-normal leading-none"
                >
                  Don&rsquo;t show this again
                </Label>
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={confirm}>Replace</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
