import type { Edge, Node, ReactFlowInstance } from "@xyflow/react";
import { atom } from "jotai";
import { validate } from "@/engine/validate";
import { estimateWorkflowCost } from "../lib/cost-estimate";
import { clientNodeRegistry, toGraph } from "../lib/validation";

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

/** Epoch ms of the last successful graph save; null before the first save (AF-UX-03). */
export const lastSavedAtAtom = atom<number | null>(null);

/** Live-recomputed lint result over the canvas draft (AF-M1-07). */
export const validationResultAtom = atom((get) =>
  validate(toGraph(get(nodesAtom), get(edgesAtom)), clientNodeRegistry),
);

/** Live-recomputed pre-run cost estimation over the canvas draft (AF-M5-06). */
export const workflowCostEstimateAtom = atom((get) =>
  estimateWorkflowCost(get(nodesAtom)),
);

/** When set, selecting a node in the palette will append and connect it to this node (AF-M1-05). */
export const appendSourceNodeIdAtom = atom<string | null>(null);
export const nodeSelectorOpenAtom = atom<boolean>(false);
