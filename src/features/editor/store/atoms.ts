import type { Edge, Node, ReactFlowInstance } from "@xyflow/react";
import { atom } from "jotai";

export type EditorNode = Node & {
  /** Display name; falls back to the node type when empty. */
  name?: string;
  notes?: string;
  disabled?: boolean;
};

export const editorAtom = atom<ReactFlowInstance | null>(null);

/** Server-fetched nodes — set once on workflow load, updated after each save. */
export const nodesAtom = atom<EditorNode[]>([]);
/** Server-fetched edges — same lifecycle as nodesAtom. */
export const edgesAtom = atom<Edge[]>([]);

/** Id of the single currently selected node; null when nothing or a group is selected. */
export const selectedNodeIdAtom = atom<string | null>(null);

export type SaveStatus = "saved" | "saving" | "unsaved" | "failed";
export const saveStatusAtom = atom<SaveStatus>("saved");
