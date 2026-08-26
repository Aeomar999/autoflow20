import { describe, expect, it } from "vitest";
import { buildSkippedTraces, computeDurationMs } from "./trace";

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
