import type { Edge, Node, ReactFlowInstance } from "@xyflow/react";
import { atom } from "jotai";

export const editorAtom = atom<ReactFlowInstance | null>(null);

/** Server-fetched nodes — set once on workflow load, updated after each save. */
export const nodesAtom = atom<Node[]>([]);
/** Server-fetched edges — same lifecycle as nodesAtom. */
export const edgesAtom = atom<Edge[]>([]);

export type SaveStatus = "saved" | "saving" | "unsaved" | "failed";
export const saveStatusAtom = atom<SaveStatus>("saved");
