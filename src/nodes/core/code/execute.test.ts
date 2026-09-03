import { NonRetriableError } from "inngest";
import { describe, expect, it, vi } from "vitest";
import { withResolve } from "@/nodes/shared/test-params";
import type { StepTools, WorkflowContext } from "@/nodes/types";
import { execute } from "./execute";

describe("CODE execute", () => {
  const step = {
    run: vi.fn((_name: string, fn: () => unknown) => fn()),
  } as unknown as StepTools;
  const publish = vi.fn().mockResolvedValue(undefined);

  const run = (data: Record<string, unknown>, context: WorkflowContext = {}) =>
    execute(
      withResolve({
        nodeId: "node-1",
        data: data as never,
        userId: "user-1",
        context,
        step,
        publish,
      }),
    );

  it("runs an object-return body against the resolved input (AF-M9-13)", async () => {
    const result = await run(
      { code: "return { total: input.items.length, first: input.items[0] }" },
      { items: [1, 2, 3] },
    );
    expect(result).toEqual({ total: 3, first: 1 });
  });

  it("stores an array return under items for the downstream SPLIT_OUT (AF-M9-13)", async () => {
    const result = await run(
      { code: "return input.items.map((n) => ({ value: n * 2 }))" },
      { items: [1, 2] },
    );
    expect(result).toEqual({ items: [{ value: 2 }, { value: 4 }] });
  });

  it("surfaces the user's line number on a thrown error (AF-M9-13)", async () => {
    await expect(run({ code: "const x = ;\nboom" })).rejects.toEqual(
      new NonRetriableError("Code node: Unexpected token ';' (line 1)"),
    );
  });

  it("rejects a primitive return loudly (AF-M9-13)", async () => {
    await expect(run({ code: "return 42" })).rejects.toEqual(
      new NonRetriableError(
        "Code node: expected an object or array return but got number",
      ),
    );
  });

  it("kills an infinite loop at the wall-clock cap (AF-M9-13)", async () => {
    await expect(
      run({ code: "while (true) {}", limitTimeoutMs: 250 }),
    ).rejects.toEqual(
      new NonRetriableError(
        "Code node: Code execution exceeded the 250ms wall-clock limit",
      ),
    );
  });

  it("kills an allocation bomb at the heap cap (AF-M9-13)", async () => {
    await expect(
      run({
        code: "const a = []; while (true) { a.push(new Array(1e6).fill('x')) }",
        limitHeapMb: 32,
        limitTimeoutMs: 10_000,
      }),
    ).rejects.toEqual(
      new NonRetriableError(
        "Code node: Code execution exceeded the 32MB heap limit",
      ),
    );
  });

  it("exposes no host bindings to user code (AF-M9-13)", async () => {
    const result = await run({
      code: [
        "return {",
        "  process: typeof process,",
        "  require: typeof require,",
        "  fetch: typeof fetch,",
        "  setTimeout: typeof setTimeout,",
        "  Buffer: typeof Buffer,",
        "  module: typeof module,",
        "}",
      ].join("\n"),
    });
    expect(result).toEqual({
      process: "undefined",
      require: "undefined",
      fetch: "undefined",
      setTimeout: "undefined",
      Buffer: "undefined",
      module: "undefined",
    });
  });

  it("contains prototype pollution inside the sandbox realm (AF-M9-13)", async () => {
    const result = await run({
      code: 'Object.prototype.polluted = "yes"; return { done: true }',
    });
    expect(result).toEqual({ done: true });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
