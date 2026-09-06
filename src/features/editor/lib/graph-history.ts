import type { Edge } from "@xyflow/react";
import type { EditorNode } from "@/features/editor/store/atoms";

export type GraphSnapshot = { nodes: EditorNode[]; edges: Edge[] };

function deepClone<T>(value: T): T {
  return structuredClone(value);
}

/** Structural deep-equal between two snapshots (JSON-shaped node data). */
function snapshotsEqual(a: GraphSnapshot, b: GraphSnapshot): boolean {
  if (a.nodes.length !== b.nodes.length || a.edges.length !== b.edges.length) {
    return false;
  }
  for (let i = 0; i < a.nodes.length; i += 1) {
    if (JSON.stringify(a.nodes[i]) !== JSON.stringify(b.nodes[i])) return false;
  }
  for (let i = 0; i < a.edges.length; i += 1) {
    if (JSON.stringify(a.edges[i]) !== JSON.stringify(b.edges[i])) return false;
  }
  return true;
}

/**
 * Stack-based undo/redo history for the single workflow canvas (AF-UX-05).
 *
 * Model: `present` mirrors the live graph state at all times. `commit(next)`
 * records the *pre-change* state as an undo step and advances `present` to
 * `next`, so a subsequent `undo()` returns the exact pre-change snapshot.
 *
 * `foldMs` coalesces repeat commits that arrive inside one interaction into a
 * single undo step: within the window the present is advanced but no undo step
 * is recorded. Used for (a) keystroke bursts in the node config panel and (b)
 * the node + connected-edge removals React Flow emits for one delete gesture.
 * `undo()`/`redo()` reset the fold window so the next edit always opens a
 * fresh step.
 *
 * Store 100 undo steps, mirroring the persistence-aware history contract.
 * All returned snapshots are deep clones; stored snapshots are never handed
 * out by reference.
 */
export class GraphHistory {
  static readonly LIMIT = 100;

  private initialized = false;
  private present: GraphSnapshot = { nodes: [], edges: [] };
  private pastStack: GraphSnapshot[] = [];
  private redoStack: GraphSnapshot[] = [];
  private lastCommitAt = 0;

  isInitialized(): boolean {
    return this.initialized;
  }

  /** Seed the baseline and clear both stacks. Call once per workflow load. */
  reset(initial: GraphSnapshot): void {
    this.initialized = true;
    this.present = deepClone(initial);
    this.pastStack = [];
    this.redoStack = [];
    this.lastCommitAt = 0;
  }

  /**
   * Record the post-mutation state. If `foldMs` is set and the previous commit
   * was within that many milliseconds, advance the present without recording a
   * new undo step (the current step swallows the change).
   */
  commit(next: GraphSnapshot, foldMs?: number): void {
    const nextCloned = deepClone(next);
    if (!snapshotsEqual(this.present, nextCloned)) {
      const now = Date.now();
      const fold = foldMs !== undefined && now - this.lastCommitAt <= foldMs;
      if (!fold) {
        this.pastStack.push(this.present);
        if (this.pastStack.length > GraphHistory.LIMIT) this.pastStack.shift();
        this.redoStack = [];
      }
      this.lastCommitAt = now;
    }
    this.present = nextCloned;
  }

  /** Restore the pre-change snapshot, or null when the graph is fully undone. */
  undo(): GraphSnapshot | null {
    const previous = this.pastStack.pop();
    if (previous === undefined) return null;
    this.redoStack.push(this.present);
    if (this.redoStack.length > GraphHistory.LIMIT) this.redoStack.shift();
    this.present = previous;
    this.lastCommitAt = 0;
    return deepClone(previous);
  }

  /** Restore a snapshot that undo() moved aside, or null when nothing to redo. */
  redo(): GraphSnapshot | null {
    const next = this.redoStack.pop();
    if (next === undefined) return null;
    this.pastStack.push(this.present);
    if (this.pastStack.length > GraphHistory.LIMIT) this.pastStack.shift();
    this.present = next;
    this.lastCommitAt = 0;
    return deepClone(next);
  }

  canUndo(): boolean {
    return this.pastStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }
}
