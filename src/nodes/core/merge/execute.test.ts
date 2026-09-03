import { describe, expect, it, vi } from "vitest";
import { withResolve } from "@/nodes/shared/test-params";
import type { StepTools } from "@/nodes/types";
import { execute } from "./execute";

describe("MERGE execute (AF-M9-11)", () => {
  const step = {
    run: vi.fn((_name: string, fn: () => unknown) => fn()),
  } as unknown as StepTools;
  const publish = vi.fn().mockResolvedValue(undefined);

  async function run(data: Record<string, unknown>, context: unknown) {
    return execute(
      withResolve({
        nodeId: "node-1",
        data,
        userId: "user-1",
        context: context as Record<string, unknown>,
        step,
        publish,
      }),
    );
  }

  it("byInput: per-port context maps to input0/input1 (no dash)", async () => {
    const result = await run(
      { mode: "byInput", inputCount: 2 },
      { "input-0": { fromA: "a" }, "input-1": { fromB: "b" } },
    );
    expect(result).toEqual({
      input0: { fromA: "a" },
      input1: { fromB: "b" },
    });
  });

  it("byInput: an absent port becomes keyed null, not missing", async () => {
    const result = await run(
      { mode: "byInput", inputCount: 2 },
      { "input-0": { fromA: "a" }, "input-1": null },
    );
    expect(result).toEqual({ input0: { fromA: "a" }, input1: null });
    // Falsey null vs empty object are distinct: an empty {} is a real merge
    // target, null is a branch that never ran.
    expect(Object.keys(result as object)).toContain("input1");
  });

  it("append: concatenates every array found across the branches into items", async () => {
    const result = await run(
      { mode: "append", inputCount: 2 },
      { "input-0": { items: [1, 2] }, "input-1": { items: [3] } },
    );
    expect(result).toEqual({
      "input-0": { items: [1, 2] },
      "input-1": { items: [3] },
      items: [1, 2, 3],
    });
  });

  it("append: a branch without an items array contributes nothing", async () => {
    const result = await run(
      { mode: "append", inputCount: 2 },
      { "input-0": { items: [1] }, "input-1": { note: "x" } },
    );
    const resultObj = result as Record<string, unknown>;
    expect(resultObj.items).toEqual([1]);
  });

  it("mergeByKey: deep-merges branch objects, later branches win", async () => {
    const result = await run(
      { mode: "mergeByKey", inputCount: 2 },
      {
        "input-0": { a: 1, nested: { x: 1, keep: "a" } },
        "input-1": { b: 2, nested: { y: 2, keep: "b" } },
      },
    );
    expect(result).toEqual({
      a: 1,
      b: 2,
      nested: { x: 1, keep: "b", y: 2 },
    });
  });

  it("combine: wraps every branch value under combineKey", async () => {
    const result = await run(
      { mode: "combine", combineKey: "left", inputCount: 2 },
      { "input-0": { fromA: "a" }, "input-1": null },
    );
    const resultObj = result as Record<string, unknown>;
    expect(resultObj.left).toEqual({
      "input-0": { fromA: "a" },
      "input-1": null,
    });
  });

  it("defaults to byInput when mode is absent", async () => {
    const result = await run(
      { inputCount: 2 },
      { "input-0": { fromA: "a" }, "input-1": { fromB: "b" } },
    );
    expect(result).toEqual({
      input0: { fromA: "a" },
      input1: { fromB: "b" },
    });
  });
});
