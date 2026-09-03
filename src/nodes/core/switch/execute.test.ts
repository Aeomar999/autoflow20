import { NonRetriableError } from "inngest";
import { describe, expect, it, vi } from "vitest";
import { UNMATCHED_OUTPUT_PORT } from "@/inngest/trace";
import { withResolve } from "@/nodes/shared/test-params";
import type { StepTools } from "@/nodes/types";
import { execute } from "./execute";

describe("SWITCH execute", () => {
  const step = {
    run: vi.fn((_name: string, fn: () => unknown) => fn()),
  } as unknown as StepTools;
  const publish = vi.fn().mockResolvedValue(undefined);

  it("routes to the FIRST matching rule's outputKey (AF-M9-09)", async () => {
    const result = await execute(
      withResolve({
        nodeId: "node-1",
        data: {
          rules: [
            {
              outputKey: "low",
              left: "{{score}}",
              operator: "lte",
              right: "10",
            },
            {
              outputKey: "mid",
              left: "{{score}}",
              operator: "lte",
              right: "20",
            },
            {
              outputKey: "high",
              left: "{{score}}",
              operator: "gt",
              right: "20",
            },
          ],
          fallback: "none",
        },
        userId: "user-1",
        context: { score: 5 },
        step,
        publish,
      }),
    );

    expect(result._outputPort).toBe("low");
    expect(result.switchResult).toBe("low");
  });

  it("each rule routes to its own branch (first-match-wins) (AF-M9-09)", async () => {
    async function portFor(score: number) {
      const result = await execute(
        withResolve({
          nodeId: "node-1",
          data: {
            rules: [
              {
                outputKey: "low",
                left: "{{score}}",
                operator: "lte",
                right: "10",
              },
              {
                outputKey: "mid",
                left: "{{score}}",
                operator: "lte",
                right: "20",
              },
              {
                outputKey: "high",
                left: "{{score}}",
                operator: "gt",
                right: "20",
              },
            ],
            fallback: "none",
          },
          userId: "user-1",
          context: { score },
          step,
          publish,
        }),
      );
      return result._outputPort;
    }

    expect(await portFor(5)).toBe("low");
    expect(await portFor(15)).toBe("mid");
    expect(await portFor(25)).toBe("high");
  });

  it("emits the extra port when fallback is 'extra' and nothing matches (AF-M9-09)", async () => {
    const result = await execute(
      withResolve({
        nodeId: "node-1",
        data: {
          rules: [
            {
              outputKey: "yes",
              left: "{{flag}}",
              operator: "equals",
              right: "true",
            },
          ],
          fallback: "extra",
        },
        userId: "user-1",
        context: { flag: "false" },
        step,
        publish,
      }),
    );

    expect(result._outputPort).toBe("extra");
    expect(result.switchResult).toBeNull();
  });

  it("emits the no-match sentinel when fallback is 'none' (AF-M9-09)", async () => {
    const result = await execute(
      withResolve({
        nodeId: "node-1",
        data: {
          rules: [
            {
              outputKey: "yes",
              left: "{{flag}}",
              operator: "equals",
              right: "true",
            },
          ],
          fallback: "none",
        },
        userId: "user-1",
        context: { flag: "false" },
        step,
        publish,
      }),
    );

    expect(result._outputPort).toBe(UNMATCHED_OUTPUT_PORT);
    expect(result.switchResult).toBeNull();
  });

  it("defaults fallback to 'none' when omitted (AF-M9-09)", async () => {
    const result = await execute(
      withResolve({
        nodeId: "node-1",
        data: {
          rules: [
            { outputKey: "a", left: "x", operator: "equals", right: "y" },
          ],
        },
        userId: "user-1",
        context: {},
        step,
        publish,
      }),
    );

    expect(result._outputPort).toBe(UNMATCHED_OUTPUT_PORT);
  });

  it("supports numeric comparisons (AF-M9-09)", async () => {
    const result = await execute(
      withResolve({
        nodeId: "node-1",
        data: {
          rules: [
            { outputKey: "big", left: "{{n}}", operator: "gt", right: "100" },
          ],
          fallback: "none",
        },
        userId: "user-1",
        context: { n: 200 },
        step,
        publish,
      }),
    );

    expect(result._outputPort).toBe("big");
  });

  it("throws a NonRetriableError on duplicate output keys (AF-M9-09)", async () => {
    await expect(
      execute(
        withResolve({
          nodeId: "node-1",
          data: {
            rules: [
              { outputKey: "dup", left: "a", operator: "equals", right: "a" },
              { outputKey: "dup", left: "b", operator: "equals", right: "b" },
            ],
            fallback: "none",
          },
          userId: "user-1",
          context: {},
          step,
          publish,
        }),
      ),
    ).rejects.toEqual(
      new NonRetriableError(
        'Switch node: duplicate rule output key "dup". Each rule must route to a unique output port.',
      ),
    );
  });

  it("spreads the incoming context onto the result (AF-M9-09)", async () => {
    const result = await execute(
      withResolve({
        nodeId: "node-1",
        data: {
          rules: [
            { outputKey: "hit", left: "{{a}}", operator: "equals", right: "1" },
          ],
          fallback: "none",
        },
        userId: "user-1",
        context: { a: "1", existing: "kept" },
        step,
        publish,
      }),
    );

    expect(result.existing).toBe("kept");
    expect(result._outputPort).toBe("hit");
  });
});
