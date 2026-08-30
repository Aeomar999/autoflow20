import { describe, expect, it } from "vitest";
import {
  buildGraphMaps,
  buildSkippedTraces,
  computeDurationMs,
  computeSkippableNodes,
  extractStepUsage,
  markTakenEdges,
} from "./trace";

describe("buildSkippedTraces", () => {
  const nodes = [
    { id: "n0", name: "Trigger", type: "MANUAL_TRIGGER", data: {} },
    { id: "n1", name: "Fetch", type: "HTTP_REQUEST", data: {} },
    { id: "n2", name: "Notify", type: "SLACK", data: {} },
  ];

  it("marks every node at or after fromIndex as SKIPPED with reason", () => {
    const rows = buildSkippedTraces(
      nodes,
      1,
      "exec-1",
      "Skipped: an upstream node failed",
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      executionId: "exec-1",
      nodeId: "n1",
      nodeName: "Fetch",
      nodeType: "HTTP_REQUEST",
      status: "SKIPPED",
      attempt: 0,
      order: 1,
      skipReason: "Skipped: an upstream node failed",
    });
    expect(rows[1]).toMatchObject({
      nodeId: "n2",
      nodeName: "Notify",
      order: 2,
    });
  });

  it("returns no rows when the failure happened on the last node", () => {
    const rows = buildSkippedTraces(nodes, 3, "exec-1", "reason");
    expect(rows).toHaveLength(0);
  });

  it("keeps topological order stable in row.order", () => {
    const rows = buildSkippedTraces(nodes, 0, "exec-1", "reason");
    expect(rows.map((row) => row.order)).toEqual([0, 1, 2]);
  });

  it("sets skipReason on every row", () => {
    const rows = buildSkippedTraces(nodes, 0, "exec-1", "cancelled");
    for (const row of rows) {
      expect(row.skipReason).toBe("cancelled");
    }
  });
});

describe("computeDurationMs", () => {
  it("measures elapsed milliseconds", () => {
    expect(computeDurationMs(1000, 1525)).toBe(525);
  });

  it("clamps negative deltas (clock skew) to zero", () => {
    expect(computeDurationMs(2000, 1500)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AF-M2-04 — branch-taken semantics + graph map helpers
// ---------------------------------------------------------------------------

describe("buildGraphMaps", () => {
  it("builds adjacency and incoming maps from edges", () => {
    const edges = [
      { fromNodeId: "A", toNodeId: "B", fromOutput: "main", toInput: "main" },
      { fromNodeId: "B", toNodeId: "C", fromOutput: "main", toInput: "main" },
    ];
    const { adjacency, incoming } = buildGraphMaps(edges);
    expect(adjacency.get("A")).toHaveLength(1);
    expect(adjacency.get("A")?.[0].toNodeId).toBe("B");
    expect(incoming.get("B")).toHaveLength(1);
    expect(incoming.get("B")?.[0].fromNodeId).toBe("A");
    expect(incoming.has("A")).toBe(false); // no incoming for A
  });
});

describe("buildSkippableNodes", () => {
  // Graph: Trigger → A → B → C, Trigger → D
  const triggerId = "trigger";
  const nodeIds = ["trigger", "A", "B", "C", "D"];
  const edges = [
    {
      fromNodeId: "trigger",
      toNodeId: "A",
      fromOutput: "main",
      toInput: "main",
    },
    { fromNodeId: "A", toNodeId: "B", fromOutput: "main", toInput: "main" },
    { fromNodeId: "B", toNodeId: "C", fromOutput: "main", toInput: "main" },
    {
      fromNodeId: "trigger",
      toNodeId: "D",
      fromOutput: "alt",
      toInput: "main",
    },
  ];
  const { adjacency } = buildGraphMaps(edges);

  it("returns empty set when all edges are taken", () => {
    const taken = new Set(["trigger:main", "trigger:alt", "A:main", "B:main"]);
    const skippable = computeSkippableNodes(
      [triggerId],
      taken,
      adjacency,
      nodeIds,
    );
    expect(skippable.size).toBe(0);
  });

  it("skips nodes downstream of untaken edges", () => {
    // Only trigger→A is taken; B, C, D are not reachable.
    const taken = new Set(["trigger:main"]);
    const skippable = computeSkippableNodes(
      [triggerId],
      taken,
      adjacency,
      nodeIds,
    );
    expect(skippable.has("B")).toBe(true);
    expect(skippable.has("C")).toBe(true);
    expect(skippable.has("D")).toBe(true);
    expect(skippable.has("A")).toBe(false); // reachable via taken edge
    expect(skippable.has("trigger")).toBe(false); // trigger always reachable
  });

  it("handles branching: one branch taken, the other skipped", () => {
    // Trigger has two outputs: "true" → A, "false" → D
    const branchEdges = [
      {
        fromNodeId: "trigger",
        toNodeId: "A",
        fromOutput: "true",
        toInput: "main",
      },
      {
        fromNodeId: "trigger",
        toNodeId: "D",
        fromOutput: "false",
        toInput: "main",
      },
      { fromNodeId: "A", toNodeId: "B", fromOutput: "main", toInput: "main" },
    ];
    const { adjacency: adj2 } = buildGraphMaps(branchEdges);

    // trigger:true is taken (condition chose true), A executed so A:main is taken
    const taken = new Set(["trigger:true", "A:main"]);
    const skippable = computeSkippableNodes([triggerId], taken, adj2, [
      "trigger",
      "A",
      "B",
      "D",
    ]);
    expect(skippable.has("A")).toBe(false); // reachable via true branch
    expect(skippable.has("B")).toBe(false); // reachable via A:main
    expect(skippable.has("D")).toBe(true); // false branch not taken
  });

  it("always keeps triggers reachable even with no edges", () => {
    const skippable = computeSkippableNodes([triggerId], new Set(), new Map(), [
      triggerId,
    ]);
    expect(skippable.has(triggerId)).toBe(false);
  });
});

describe("markTakenEdges", () => {
  const edges = [
    { fromNodeId: "cond", toNodeId: "A", fromOutput: "true", toInput: "main" },
    { fromNodeId: "cond", toNodeId: "B", fromOutput: "false", toInput: "main" },
  ];
  const { adjacency } = buildGraphMaps(edges);

  it("marks only the declared output port for branching nodes", () => {
    const taken = new Set<string>();
    markTakenEdges("cond", "true", adjacency, taken);
    expect(taken.has("cond:true")).toBe(true);
    expect(taken.has("cond:false")).toBe(false);
  });

  it("marks all outgoing edges for non-branching nodes", () => {
    const linearEdges = [
      { fromNodeId: "X", toNodeId: "Y", fromOutput: "main", toInput: "main" },
    ];
    const { adjacency: adj } = buildGraphMaps(linearEdges);
    const taken = new Set<string>();
    markTakenEdges("X", undefined, adj, taken);
    expect(taken.has("X:main")).toBe(true);
  });

  it("does nothing for nodes with no outgoing edges", () => {
    const taken = new Set<string>();
    markTakenEdges("leaf", undefined, new Map(), taken);
    expect(taken.size).toBe(0);
  });
});

describe("extractStepUsage", () => {
  it("returns zero metrics when result has no usage", () => {
    expect(extractStepUsage(null)).toEqual({
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      model: undefined,
    });
    expect(extractStepUsage({})).toEqual({
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      model: undefined,
    });
  });

  it("extracts tokens and cost from __usage", () => {
    const usage = extractStepUsage({
      data: { text: "hello" },
      __usage: {
        tokensIn: 150,
        tokensOut: 45,
        costUsd: 0.000125,
        model: "openai:gpt-4o",
      },
    });

    expect(usage).toEqual({
      tokensIn: 150,
      tokensOut: 45,
      costUsd: 0.000125,
      model: "openai:gpt-4o",
    });
  });

  it("normalizes prompt_tokens and completion_tokens from AI SDK shapes", () => {
    const usage = extractStepUsage({
      _usage: {
        promptTokens: 200,
        completionTokens: 80,
        costUsd: 0.0015,
        model: "anthropic:claude-3-5-sonnet",
      },
    });

    expect(usage).toEqual({
      tokensIn: 200,
      tokensOut: 80,
      costUsd: 0.0015,
      model: "anthropic:claude-3-5-sonnet",
    });
  });
});
