import { describe, expect, it } from "vitest";
import {
  computeSkipNodes,
  retryableStatuses,
} from "./executions-router-helpers";

describe("executions router helpers", () => {
  describe("retryableStatuses", () => {
    it("includes FAILED, TIMED_OUT, CANCELLED", () => {
      expect(retryableStatuses).toContain("FAILED");
      expect(retryableStatuses).toContain("TIMED_OUT");
      expect(retryableStatuses).toContain("CANCELLED");
    });

    it("does not include RUNNING or SUCCESS", () => {
      expect(retryableStatuses).not.toContain("RUNNING");
      expect(retryableStatuses).not.toContain("SUCCESS");
    });
  });

  describe("computeSkipNodes", () => {
    it("returns empty array when target is a trigger (in-degree 0)", () => {
      const snapshot = {
        nodes: [{ id: "trigger" }, { id: "action" }],
        connections: [{ fromNodeId: "trigger", toNodeId: "action" }],
      };
      expect(computeSkipNodes(snapshot, "trigger")).toEqual([]);
    });

    it("skips all nodes before the target in a linear chain", () => {
      const snapshot = {
        nodes: [{ id: "a" }, { id: "b" }, { id: "c" }],
        connections: [
          { fromNodeId: "a", toNodeId: "b" },
          { fromNodeId: "b", toNodeId: "c" },
        ],
      };
      expect(computeSkipNodes(snapshot, "c")).toEqual(["a", "b"]);
    });

    it("skips only upstream nodes in a diamond", () => {
      const snapshot = {
        nodes: [
          { id: "trigger" },
          { id: "left" },
          { id: "right" },
          { id: "merge" },
        ],
        connections: [
          { fromNodeId: "trigger", toNodeId: "left" },
          { fromNodeId: "trigger", toNodeId: "right" },
          { fromNodeId: "left", toNodeId: "merge" },
          { fromNodeId: "right", toNodeId: "merge" },
        ],
      };
      const skipped = computeSkipNodes(snapshot, "merge");
      expect(skipped).toContain("trigger");
      expect(skipped).toContain("left");
      expect(skipped).toContain("right");
      expect(skipped).not.toContain("merge");
    });

    it("returns empty array for null/missing snapshot", () => {
      expect(computeSkipNodes(null, "any")).toEqual([]);
      expect(computeSkipNodes({}, "any")).toEqual([]);
    });

    it("returns empty array when target not in graph", () => {
      const snapshot = {
        nodes: [{ id: "a" }],
        connections: [],
      };
      expect(computeSkipNodes(snapshot, "missing")).toEqual([]);
    });
  });
});
