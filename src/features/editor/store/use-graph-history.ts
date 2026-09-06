"use client";

import { useSetAtom } from "jotai";
import { useCallback, useEffect, useRef } from "react";
import { GraphHistory, type GraphSnapshot } from "../lib/graph-history";
import { edgesAtom, nodesAtom, saveStatusAtom } from "./atoms";

/**
 * Owns the canvas undo/redo history (AF-UX-05).
 *
 * `commit` records the *post*-mutation snapshot so the pre-mutation state is
 * the undo target. Call sites pass the exact state they just applied (captured
 * from inside the jotai updater) plus a fold window when repeated sub-edits
 * should collapse into one undo step (`CONFIG_TYPING_FOLD_MS` for keystroke
 * bursts, `STRUCTURAL_FOLD_MS` for a single delete gesture's node+edge pair).
 *
 * Declares the keyboard shortcuts: Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z and
 * Ctrl+Y redo. Shortcuts are suppressed while focus is in a text control or
 * an overlay (node selector, initial-trigger confirm dialog) is open, via the
 * `disabled` option.
 */
export function useGraphHistory({
  disabled = false,
}: {
  disabled?: boolean;
} = {}) {
  const storeHistoryRef = useRef<GraphHistory | null>(null);
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;

  if (storeHistoryRef.current === null) {
    storeHistoryRef.current = new GraphHistory();
  }
  const history = storeHistoryRef.current;

  const setNodes = useSetAtom(nodesAtom);
  const setEdges = useSetAtom(edgesAtom);
  const setSaveStatus = useSetAtom(saveStatusAtom);

  const applySnapshot = useCallback(
    (snapshot: GraphSnapshot | null): void => {
      if (!snapshot) return;
      setNodes(snapshot.nodes);
      setEdges(snapshot.edges);
      setSaveStatus("unsaved");
    },
    [setEdges, setNodes, setSaveStatus],
  );

  /** Seed the baseline from server data; no-op on workflow re-refetches. */
  const ensureInitialized = useCallback(
    (initial: GraphSnapshot): void => {
      if (!history.isInitialized()) history.reset(initial);
    },
    [history],
  );

  /** Record the post-mutation snapshot the caller just applied (see class docs). */
  const commit = useCallback(
    (next: GraphSnapshot, foldMs?: number): void => {
      history.commit(next, foldMs);
    },
    [history],
  );

  const undo = useCallback(() => {
    applySnapshot(history.undo());
  }, [applySnapshot, history]);

  const redo = useCallback(() => {
    applySnapshot(history.redo());
  }, [applySnapshot, history]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (disabledRef.current) return;
      const target = event.target as HTMLElement | null;
      if (
        target !== null &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return;
      const key = event.key.toLowerCase();
      if (key === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (key === "y" && !event.shiftKey) {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [redo, undo]);

  return { commit, ensureInitialized, redo, undo };
}
