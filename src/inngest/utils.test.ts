import { describe, expect, it } from "vitest";
import type { Connection, Node } from "@/generated/prisma";
import { topologicalSort } from "./utils";

const node = (id: string): Node =>
  ({
    id,
    workflowId: "wf_1",
    name: id,
    type: "HTTP_REQUEST",
    position: { x: 0, y: 0 },
    data: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  }) as unknown as Node;

const connection = (fromNodeId: string, toNodeId: string): Connection =>
  ({
    id: `${fromNodeId}->${toNodeId}`,
    workflowId: "wf_1",
    fromNodeId,
    toNodeId,
  }) as unknown as Connection;

describe("topologicalSort", () => {
  it("orders linear chains upstream to downstream", () => {
    const nodes = [node("c"), node("b"), node("a")];
    const connections = [connection("a", "b"), connection("b", "c")];

    const sorted = topologicalSort(nodes, connections);

    expect(sorted.map((n) => n.id)).toEqual(["a", "b", "c"]);
  });

  it("includes disconnected nodes", () => {
    const nodes = [node("lonely"), node("a"), node("b")];
    const connections = [connection("a", "b")];

    const sorted = topologicalSort(nodes, connections);
    const ids = sorted.map((n) => n.id);

    expect(ids).toHaveLength(3);
    expect(ids.indexOf("a")).toBeLessThan(ids.indexOf("b"));
    expect(ids).toContain("lonely");
  });

  it("rejects cyclic workflows", () => {
    const nodes = [node("a"), node("b")];
    const connections = [connection("a", "b"), connection("b", "a")];

    expect(() => topologicalSort(nodes, connections)).toThrow(
      "Workflow contains a cycle",
    );
  });

  it("returns all nodes unchanged when there are no connections", () => {
    const nodes = [node("x"), node("y")];
    expect(topologicalSort(nodes, []).map((n) => n.id)).toEqual(["x", "y"]);
  });
});
