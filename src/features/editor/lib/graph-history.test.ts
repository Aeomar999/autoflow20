import type { Edge } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import type { EditorNode } from "@/features/editor/store/atoms";
import { GraphHistory, type GraphSnapshot } from "./graph-history";

type Fixture = { nodes: EditorNode[]; edges: Edge[] };

function node(id: string, position = { x: 0, y: 0 }): EditorNode {
  return { id, type: "core.manual-trigger", data: {}, position };
}

function edge(id: string, source: string, target: string): Edge {
  return { id, source, target };
}

const base: Fixture = {
  nodes: [node("a"), node("b")],
  edges: [edge("e1", "a", "b")],
};

function historyOf(...snapshots: GraphSnapshot[]) {
  const history = new GraphHistory();
  history.reset(base);
  for (const snapshot of snapshots) history.commit(snapshot);
  return history;
}

describe("GraphHistory.reset", () => {
  it("seeds the baseline and clears past and future", () => {
    const history = historyOf({ nodes: [node("a")], edges: [] });
    history.reset(base);
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);
  });

  it("is uninitialized until reset is called", () => {
    const history = new GraphHistory();
    expect(history.isInitialized()).toBe(false);
    expect(history.undo()).toBeNull();
    expect(history.redo()).toBeNull();
  });
});

describe("GraphHistory.commit", () => {
  it("records the pre-change state as an undo step", () => {
    const next = {
      nodes: [node("a"), node("b"), node("c")],
      edges: base.edges,
    };
    const history = historyOf(next);
    expect(history.canUndo()).toBe(true);
    expect(history.undo()).toEqual(base);
  });

  it("is a no-op for a snapshot equal to the present one", () => {
    const history = historyOf(base);
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);
  });
});

describe("GraphHistory folding", () => {
  it("folds repeat commits within the fold window into one undo step", () => {
    const one = { nodes: [node("a"), node("b"), node("c")], edges: base.edges };
    const two = { nodes: [node("a"), node("b"), node("d")], edges: base.edges };
    const three = {
      nodes: [node("a"), node("b"), node("e")],
      edges: base.edges,
    };
    const history = new GraphHistory();
    history.reset(base);
    history.commit(one, 50);
    history.commit(two, 50);
    history.commit(three, 50);

    expect(history.undo()).toEqual(base);
    expect(history.undo()).toBeNull();
    expect(history.redo()).toEqual(three);
  });

  it("opens a fresh undo step once the fold window lapses", async () => {
    const one = { nodes: [node("a"), node("b"), node("c")], edges: base.edges };
    const two = { nodes: [node("a"), node("b"), node("d")], edges: base.edges };
    const history = new GraphHistory();
    history.reset(base);
    history.commit(one, 50);
    history.commit(two, 50); // folded into the one->two step
    await new Promise((resolve) => setTimeout(resolve, 60));
    history.commit(
      { nodes: [node("a"), node("b"), node("e")], edges: base.edges },
      50,
    );

    expect(history.undo()).toEqual(two);
    expect(history.undo()).toEqual(base);
    expect(history.undo()).toBeNull();
  });

  it("resets the fold window after undo and cuts the redo branch", () => {
    const one = { nodes: [node("a"), node("b"), node("c")], edges: base.edges };
    const two = { nodes: [node("a"), node("b"), node("d")], edges: base.edges };
    const history = new GraphHistory();
    history.reset(base);
    history.commit(one, 50);
    history.undo();
    history.commit(two, 50);

    expect(history.canRedo()).toBe(false);
    expect(history.undo()).toEqual(base);
    expect(history.undo()).toBeNull();
  });
});

describe("GraphHistory.undo/redo", () => {
  it("walks back and forward across discrete commits", () => {
    const one = { nodes: [node("a")], edges: [] };
    const two = { nodes: [node("a"), node("b")], edges: [] };
    const three = { nodes: [node("a"), node("b"), node("c")], edges: [] };
    const history = new GraphHistory();
    history.reset(base);
    history.commit(one);
    history.commit(two);
    history.commit(three);

    expect(history.undo()).toEqual(two);
    expect(history.undo()).toEqual(one);
    expect(history.undo()).toEqual(base);
    expect(history.undo()).toBeNull();

    expect(history.redo()).toEqual(one);
    expect(history.redo()).toEqual(two);
    expect(history.redo()).toEqual(three);
    expect(history.redo()).toBeNull();
  });

  it("returns deep clones so callers cannot mutate stored state", () => {
    const next = {
      nodes: [node("a"), node("b"), node("c")],
      edges: base.edges,
    };
    const history = historyOf(next);
    const restored = history.undo();
    expect(restored).not.toBeNull();
    if (restored === null) return;
    restored.nodes[0].name = "tampered";
    // Undo again returns the same pre-change state, untainted by the mutation.
    expect(history.redo()).toEqual(next);
    expect(history.undo()).toEqual(base);
  });
});

describe("GraphHistory.canUndo/canRedo", () => {
  it("tracks availability across reset, commit, undo, and redo", () => {
    const next = {
      nodes: [node("a"), node("b"), node("c")],
      edges: base.edges,
    };
    const history = new GraphHistory();
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);

    history.reset(base);
    expect(history.canUndo()).toBe(false);

    history.commit(next);
    expect(history.canUndo()).toBe(true);
    expect(history.canRedo()).toBe(false);

    history.undo();
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(true);

    history.redo();
    expect(history.canUndo()).toBe(true);
    expect(history.canRedo()).toBe(false);
  });

  it("is false once the graph is fully undone back to the baseline", () => {
    const next = {
      nodes: [node("a"), node("b"), node("c")],
      edges: base.edges,
    };
    const history = historyOf(next);
    history.undo();
    expect(history.canUndo()).toBe(false);
  });
});

describe("GraphHistory limit", () => {
  it("drops the oldest step beyond the 100-step cap", () => {
    const history = new GraphHistory();
    history.reset(base);
    for (let i = 0; i < 105; i += 1) {
      history.commit({ nodes: [node(`n-${i}`)], edges: [] });
    }
    expect(history.canUndo()).toBe(true);
    // 105 commits stacked on the baseline record 105 previous states; the cap
    // keeps only the most recent 100. The oldest 5 (baseline + first 4 commits)
    // are evicted, so re-doing from the deepest point returns `n-4`.
    let deepest: GraphSnapshot | null = null;
    let count = 0;
    while (history.canUndo()) {
      deepest = history.undo();
      count += 1;
    }
    expect(count).toBe(100);
    expect(deepest?.nodes[0]?.id).toBe("n-4");
  });
});
