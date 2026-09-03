import { describe, expect, it, vi } from "vitest";
import { SEGMENT_DROP_ITEM_KEY } from "@/inngest/trace";
import { withResolve } from "@/nodes/shared/test-params";
import type { NodeRunParams } from "@/nodes/types";
import { execute } from "./execute";

const step = {
  run: async <T>(_id: string, fn: () => Promise<T>): Promise<T> => fn(),
} as unknown as NodeRunParams["step"];

const publish = vi.fn(async () => {});

const run = (
  data: Record<string, unknown>,
  opts: {
    context?: Record<string, unknown>;
    item?: { value: unknown; index: number };
  } = {},
) =>
  execute(
    withResolve({
      data,
      nodeId: "node_filter",
      userId: "user_1",
      organizationId: "org_1",
      workflowId: "wf_1",
      context: opts.context ?? {},
      step,
      publish,
      ...(opts.item ? { item: opts.item } : {}),
    }) as unknown as NodeRunParams,
  );

describe("FILTER inside a fan-out segment (AF-M10-10)", () => {
  const item = { value: { status: "active" }, index: 0 };

  it("passes a matching item through untouched", async () => {
    const result = await run(
      {
        left: "{{$item.status}}",
        operator: "equals",
        right: "active",
      },
      { context: { upstream: 1 }, item },
    );
    expect(result[SEGMENT_DROP_ITEM_KEY]).toBeUndefined();
    expect(result.upstream).toBe(1);
  });

  it("drops a non-matching item with the segment marker", async () => {
    const result = await run(
      {
        left: "{{$item.status}}",
        operator: "equals",
        right: "archived",
      },
      { item },
    );
    // Not an error and not a failure — the item was handled and simply does
    // not continue.
    expect(result[SEGMENT_DROP_ITEM_KEY]).toBe(true);
  });

  it("does not keep an item whose flag is boolean false", async () => {
    const result = await run(
      { left: "{{$item.ok}}", operator: "is_true", valueType: "boolean" },
      { item: { value: { ok: false }, index: 0 } },
    );
    expect(result[SEGMENT_DROP_ITEM_KEY]).toBe(true);
  });

  it("fails on a type mismatch rather than matching nothing silently", async () => {
    await expect(
      run(
        {
          left: "{{$item.status}}",
          operator: "gt",
          right: "100",
          valueType: "number",
        },
        { item },
      ),
    ).rejects.toThrow(/not a number/i);
  });
});

describe("FILTER outside a segment (AF-M10-10)", () => {
  const context = {
    rows: [
      { status: "active", amount: 120 },
      { status: "archived", amount: 300 },
      { status: "active", amount: 50 },
    ],
  };

  const items = "{{{json rows}}}";

  it("returns only the matching elements", async () => {
    const result = await run(
      {
        variableName: "filtered",
        items,
        itemPath: "status",
        operator: "equals",
        right: "active",
      },
      { context },
    );

    const out = result.filtered as { items: unknown[]; kept: number };
    expect(out.kept).toBe(2);
    expect(out.items).toEqual([
      { status: "active", amount: 120 },
      { status: "active", amount: 50 },
    ]);
  });

  it("reports what it removed, so a surprising result is visible", async () => {
    const result = await run(
      {
        variableName: "filtered",
        items,
        itemPath: "amount",
        operator: "gt",
        right: "100",
        valueType: "number",
      },
      { context },
    );
    expect(result.filtered).toMatchObject({
      kept: 2,
      removed: 1,
      total: 3,
    });
  });

  it("ends cleanly when everything is filtered out", async () => {
    // A fully-filtered branch is an answer, not a failure.
    const result = await run(
      {
        variableName: "filtered",
        items,
        itemPath: "status",
        operator: "equals",
        right: "nothing-matches-this",
      },
      { context },
    );
    expect(result.filtered).toMatchObject({ kept: 0, removed: 3, total: 3 });
  });

  it("skips an element with no value at the path rather than failing", async () => {
    const result = await run(
      {
        variableName: "filtered",
        items: "{{{json mixed}}}",
        itemPath: "amount",
        operator: "gte",
        right: "1",
        valueType: "number",
      },
      { context: { mixed: [{ amount: 5 }, { other: 1 }, { amount: 9 }] } },
    );
    expect((result.filtered as { kept: number }).kept).toBe(2);
  });

  it("refuses a non-array items expression by name", async () => {
    await expect(
      run(
        {
          variableName: "filtered",
          items: "{{{json notAnArray}}}",
          itemPath: "x",
          operator: "equals",
          right: "y",
        },
        { context: { notAnArray: { x: 1 } } },
      ),
    ).rejects.toThrow(/not an array/i);
  });

  it("says what to do when neither an array nor a segment is available", async () => {
    await expect(
      run({ variableName: "filtered", operator: "equals", right: "x" }),
    ).rejects.toThrow(/SPLIT_OUT segment/);
  });
});
