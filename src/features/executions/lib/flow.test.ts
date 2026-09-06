import { describe, expect, it } from "vitest";

import { computeExecutionFlow } from "./flow";

type Trace = { nodeId: string | null; status: string };

function trace(nodeId: string | null, status: string): Trace {
  return { nodeId, status };
}

const LINE_GRAPH = {
  nodes: [
    { id: "trigger", name: "Start", type: "MANUAL_TRIGGER", data: {} },
    { id: "extract", name: "Extract", type: "AI_EXTRACT", data: {} },
    { id: "notify", name: "Notify", type: "SLACK_SEND", data: {} },
  ],
  connections: [
    {
      fromNodeId: "trigger",
      toNodeId: "extract",
      fromOutput: "main",
      toInput: "main",
    },
    {
      fromNodeId: "extract",
      toNodeId: "notify",
      fromOutput: "main",
      toInput: "main",
    },
  ],
};

describe("computeExecutionFlow", () => {
  it("returns zero progress for a fresh run with no traces", () => {
    const flow = computeExecutionFlow(LINE_GRAPH, []);
    expect(flow.total).toBe(3);
    expect(flow.done).toBe(0);
    expect(flow.percent).toBe(0);
    expect(flow.order).toEqual(["trigger", "extract", "notify"]);
    expect(flow.nodes.map((n) => n.id)).toEqual([
      "trigger",
      "extract",
      "notify",
    ]);
  });

  it("counts one done node as one third", () => {
    const flow = computeExecutionFlow(LINE_GRAPH, [
      trace("trigger", "SUCCESS"),
    ]);
    expect(flow.done).toBe(1);
    expect(flow.percent).toBe(33);
  });

  it("counts two done nodes as two thirds", () => {
    const flow = computeExecutionFlow(LINE_GRAPH, [
      trace("trigger", "SUCCESS"),
      trace("extract", "SUCCESS"),
    ]);
    expect(flow.done).toBe(2);
    expect(flow.percent).toBe(67);
  });

  it("reports 100% when every node is terminal", () => {
    const flow = computeExecutionFlow(LINE_GRAPH, [
      trace("trigger", "SUCCESS"),
      trace("extract", "SUCCESS"),
      trace("notify", "SUCCESS"),
    ]);
    expect(flow.done).toBe(3);
    expect(flow.percent).toBe(100);
  });

  it("counts SKIPPED branch nodes as done", () => {
    const branch = {
      nodes: [
        { id: "trigger", name: "Start", type: "MANUAL_TRIGGER", data: {} },
        { id: "a", name: "A", type: "HTTP_REQUEST", data: {} },
        { id: "b", name: "B", type: "HTTP_REQUEST", data: {} },
      ],
      connections: [
        {
          fromNodeId: "trigger",
          toNodeId: "a",
          fromOutput: "main",
          toInput: "main",
        },
        {
          fromNodeId: "trigger",
          toNodeId: "b",
          fromOutput: "main",
          toInput: "main",
        },
      ],
    };
    const flow = computeExecutionFlow(branch, [
      trace("trigger", "SUCCESS"),
      trace("a", "SUCCESS"),
      trace("b", "SKIPPED"),
    ]);
    expect(flow.done).toBe(3);
    expect(flow.percent).toBe(100);
  });

  it("counts a segment interior node once despite many item rows", () => {
    const flow = computeExecutionFlow(LINE_GRAPH, [
      trace("trigger", "SUCCESS"),
      trace("extract", "SUCCESS"),
      trace("extract", "SUCCESS"),
      trace("extract", "SUCCESS"),
      trace("notify", "SUCCESS"),
    ]);
    expect(flow.done).toBe(3);
    expect(flow.percent).toBe(100);
  });

  it("includes disabled nodes in the total and counts a SKIPPED row as done", () => {
    const graph = {
      nodes: [
        {
          id: "trigger",
          name: "Start",
          type: "MANUAL_TRIGGER",
          data: {},
          disabled: false,
        },
        {
          id: "old",
          name: "Old",
          type: "HTTP_REQUEST",
          data: {},
          disabled: true,
        },
      ],
      connections: [
        {
          fromNodeId: "trigger",
          toNodeId: "old",
          fromOutput: "main",
          toInput: "main",
        },
      ],
    };
    const flow = computeExecutionFlow(graph, [
      trace("trigger", "SUCCESS"),
      trace("old", "SKIPPED"),
    ]);
    expect(flow.total).toBe(2);
    expect(flow.done).toBe(2);
    expect(flow.percent).toBe(100);
  });

  it("freezes below 100% when a cancelled run leaves RUNNING work unresolved", () => {
    const flow = computeExecutionFlow(LINE_GRAPH, [
      trace("trigger", "SUCCESS"),
      trace("extract", "RUNNING"),
    ]);
    expect(flow.done).toBe(1);
    expect(flow.percent).toBe(33);
  });

  it("never counts a WAITING row as done", () => {
    const flow = computeExecutionFlow(LINE_GRAPH, [
      trace("trigger", "WAITING"),
    ]);
    expect(flow.done).toBe(0);
    expect(flow.percent).toBe(0);
  });

  it("treats a null or absent snapshot as an empty graph at 100%", () => {
    expect(computeExecutionFlow(null, []).percent).toBe(100);
    expect(computeExecutionFlow(undefined, []).percent).toBe(100);
    expect(computeExecutionFlow({}, []).total).toBe(0);
  });

  it("falls back to snapshot node order on a cyclic graph", () => {
    const cyclic = {
      nodes: [
        { id: "a", name: "A", type: "HTTP_REQUEST", data: {} },
        { id: "b", name: "B", type: "HTTP_REQUEST", data: {} },
      ],
      connections: [
        { fromNodeId: "a", toNodeId: "b", fromOutput: "main", toInput: "main" },
        { fromNodeId: "b", toNodeId: "a", fromOutput: "main", toInput: "main" },
      ],
    };
    const flow = computeExecutionFlow(cyclic, [trace("a", "SUCCESS")]);
    expect(flow.order).toEqual(["a", "b"]);
    expect(flow.total).toBe(2);
    expect(flow.done).toBe(1);
    expect(flow.percent).toBe(50);
  });

  it("normalizes missing node names and connection ports instead of throwing", () => {
    const sloppy = {
      nodes: [{ id: "a", type: "HTTP_REQUEST", data: { x: 1 } }],
      connections: [{ fromNodeId: "a", toNodeId: "missing" }],
    };
    const flow = computeExecutionFlow(sloppy, [
      trace("a", "SUCCESS"),
      trace("nope", "SUCCESS"),
    ]);
    expect(flow.total).toBe(1);
    expect(flow.done).toBe(1);
    expect(flow.percent).toBe(100);
    expect(flow.nodes[0]).toEqual({
      id: "a",
      name: "HTTP_REQUEST",
      type: "HTTP_REQUEST",
    });
  });

  it("ignores traces for nodeIds no longer in the graph", () => {
    const flow = computeExecutionFlow(LINE_GRAPH, [trace("ghost", "SUCCESS")]);
    expect(flow.done).toBe(0);
    expect(flow.percent).toBe(0);
  });
});
