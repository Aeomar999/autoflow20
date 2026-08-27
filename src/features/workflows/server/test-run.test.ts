import { describe, expect, it } from "vitest";
import {
  buildNodeTestRunPlan,
  buildTestGraph,
  buildTestRunPlan,
  TestRunError,
  type TestGraph,
} from "./test-run";

const setData = { mappings: [] };
const trigger = {
  id: "node1",
  type: "MANUAL_TRIGGER",
  name: "MANUAL_TRIGGER",
  data: {},
};
const setA = { id: "node2", type: "SET", name: "SET", data: setData };
const target = { id: "node3", type: "SET", name: "SET", data: setData };
const tail = { id: "node4", type: "SET", name: "SET", data: setData };

function linearGraph(): TestGraph {
  return {
    nodes: [trigger, setA, target, tail],
    connections: [
      { fromNodeId: trigger.id, toNodeId: setA.id, fromOutput: "main", toInput: "main" },
      { fromNodeId: setA.id, toNodeId: target.id, fromOutput: "main", toInput: "main" },
      { fromNodeId: target.id, toNodeId: tail.id, fromOutput: "main", toInput: "main" },
    ],
  };
}

describe("buildTestGraph", () => {
  it("maps canvas nodes -> snapshot nodes with name == type", () => {
    const graph = buildTestGraph(
      [
        { id: "n1", type: "MANUAL_TRIGGER" },
        { id: "n2", type: "SET", data: { json: { fields: [] } } },
      ],
      [{ source: "n1", target: "n2" }],
    );
    expect(graph.nodes).toEqual([
      { id: "n1", name: "MANUAL_TRIGGER", type: "MANUAL_TRIGGER", data: {} },
      {
        id: "n2",
        name: "SET",
        type: "SET",
        data: { json: { fields: [] } },
      },
    ]);
    expect(graph.connections).toEqual([
      { fromNodeId: "n1", toNodeId: "n2", fromOutput: "main", toInput: "main" },
    ]);
  });

  it("defaults nullish handles to main", () => {
    const graph = buildTestGraph(
      [{ id: "n1", type: "MANUAL_TRIGGER" }, { id: "n2", type: "SET" }],
      [{ source: "n1", target: "n2", sourceHandle: null }],
    );
    expect(graph.connections[0]).toEqual({
      fromNodeId: "n1",
      toNodeId: "n2",
      fromOutput: "main",
      toInput: "main",
    });
  });
});

describe("buildTestRunPlan (whole-draft)", () => {
  it("returns an empty skip policy for a valid draft", () => {
    const plan = buildTestRunPlan(linearGraph());
    expect(plan.graphSnapshot.nodes).toHaveLength(4);
    expect(plan.skipNodes).toEqual([]);
    expect(plan.endAfterNodeId).toBeUndefined();
  });

  it("rejects an invalid draft with a clear error", () => {
    const graph: TestGraph = {
      nodes: [trigger, { ...target, type: "SCHEDULE_TRIGGER" }],
      connections: [],
    };
    expect(() => buildTestRunPlan(graph)).toThrow(TestRunError);
    expect(() => buildTestRunPlan(graph)).toThrow(/Multiple trigger/i);
  });
});

describe("buildNodeTestRunPlan (single-node)", () => {
  it("skips every upstream node and stops after the target", () => {
    const plan = buildNodeTestRunPlan(linearGraph(), target.id);
    expect(plan.skipNodes).toEqual([trigger.id, setA.id]);
    expect(plan.endAfterNodeId).toBe(target.id);
    expect(plan.skipReason).toContain(target.name);
  });

  it("targeting the trigger runs it alone", () => {
    const plan = buildNodeTestRunPlan(linearGraph(), trigger.id);
    expect(plan.skipNodes).toEqual([]);
    expect(plan.endAfterNodeId).toBe(trigger.id);
  });

  it("isolates a target on one branch of a diamond", () => {
    const graph: TestGraph = {
      nodes: [trigger, setA, target, tail],
      connections: [
        { fromNodeId: trigger.id, toNodeId: setA.id, fromOutput: "main", toInput: "main" },
        { fromNodeId: trigger.id, toNodeId: tail.id, fromOutput: "main", toInput: "main" },
        { fromNodeId: setA.id, toNodeId: target.id, fromOutput: "main", toInput: "main" },
        { fromNodeId: tail.id, toNodeId: target.id, fromOutput: "main", toInput: "main" },
      ],
    };
    const plan = buildNodeTestRunPlan(graph, target.id);
    // Everything other than the target is either skipped up front
    // (upstream) or stopped after the target (downstream).
    expect(plan.skipNodes).not.toContain(target.id);
    expect(new Set(plan.skipNodes)).toEqual(
      new Set([trigger.id, setA.id, tail.id]),
    );
  });

  it("throws when the target does not exist in the draft", () => {
    expect(() => buildNodeTestRunPlan(linearGraph(), "missing")).toThrow(
      TestRunError,
    );
    expect(() => buildNodeTestRunPlan(linearGraph(), "missing")).toThrow(
      /not found/,
    );
  });
});