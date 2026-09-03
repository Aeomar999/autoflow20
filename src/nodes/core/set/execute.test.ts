import { NonRetriableError } from "inngest";
import { describe, expect, it, vi } from "vitest";
import { withResolve } from "@/nodes/shared/test-params";
import type { StepTools } from "@/nodes/types";
import { execute } from "./execute";

describe("SET execute", () => {
  const step = {
    run: vi.fn((_name: string, fn: () => unknown) => fn()),
  } as unknown as StepTools;
  const publish = vi.fn().mockResolvedValue(undefined);

  it("sets string values and returns a fresh top-level bag (AF-M9-08)", async () => {
    const result = await execute(
      withResolve({
        nodeId: "node-1",
        data: {
          mappings: [
            { key: "name", value: "Ada" },
            { key: "count", value: "1", type: "number" },
          ],
        },
        userId: "user-1",
        context: { existing: "value" },
        step,
        publish,
      }),
    );

    expect(result).toEqual({ existing: "value", name: "Ada", count: 1 });
    expect(result).not.toBe({ existing: "value" });
  });

  it("parses each declared runtime type (AF-M9-08)", async () => {
    const result = await execute(
      withResolve({
        nodeId: "node-1",
        data: {
          mappings: [
            { key: "s", value: "hello", type: "string" },
            { key: "n", value: "42.5", type: "number" },
            { key: "nInt", value: "-7", type: "number" },
            { key: "b1", value: "true", type: "boolean" },
            { key: "b2", value: "false", type: "boolean" },
            { key: "o", value: '{"a":1,"b":[2]}', type: "object" },
            { key: "arr", value: "[1,2,3]", type: "array" },
          ],
        },
        userId: "user-1",
        context: {},
        step,
        publish,
      }),
    );

    expect(result).toEqual({
      s: "hello",
      n: 42.5,
      nInt: -7,
      b1: true,
      b2: false,
      o: { a: 1, b: [2] },
      arr: [1, 2, 3],
    });
  });

  it("defaults an absent type to string (AF-M9-08)", async () => {
    const result = await execute(
      withResolve({
        nodeId: "node-1",
        data: { mappings: [{ key: "x", value: "1" }] },
        userId: "user-1",
        context: {},
        step,
        publish,
      }),
    );

    expect(result.x).toBe("1");
  });

  it("never mutates an upstream nested object when writing a dot-path (AF-M9-08)", async () => {
    const user = { name: "Oracle", tags: ["a"] };
    const context = { user };

    const result = await execute(
      withResolve({
        nodeId: "node-1",
        data: { mappings: [{ key: "user.name", value: "Ada" }] },
        userId: "user-1",
        context,
        step,
        publish,
      }),
    );

    expect((result.user as { name: string }).name).toBe("Ada");
    expect(context.user).toBe(user);
    expect(user.name).toBe("Oracle");
    expect(user.tags).toEqual(["a"]);
  });

  it("throws a NonRetriableError naming the field when a number does not parse (AF-M9-08)", async () => {
    await expect(
      execute(
        withResolve({
          nodeId: "node-1",
          data: { mappings: [{ key: "count", value: "abc", type: "number" }] },
          userId: "user-1",
          context: {},
          step,
          publish,
        }),
      ),
    ).rejects.toEqual(
      new NonRetriableError(
        'Set node: "count" expects a number but resolved to "abc"',
      ),
    );
  });

  it("throws when a number mapping resolves to an empty value (AF-M9-08)", async () => {
    await expect(
      execute(
        withResolve({
          nodeId: "node-1",
          data: { mappings: [{ key: "count", value: "   ", type: "number" }] },
          userId: "user-1",
          context: {},
          step,
          publish,
        }),
      ),
    ).rejects.toEqual(
      new NonRetriableError(
        'Set node: "count" expects a number but resolved to an empty value',
      ),
    );
  });

  it("throws naming the field when a boolean does not parse (AF-M9-08)", async () => {
    await expect(
      execute(
        withResolve({
          nodeId: "node-1",
          data: { mappings: [{ key: "flag", value: "yes", type: "boolean" }] },
          userId: "user-1",
          context: {},
          step,
          publish,
        }),
      ),
    ).rejects.toEqual(
      new NonRetriableError(
        'Set node: "flag" expects a boolean but resolved to "yes"',
      ),
    );
  });

  it("throws when an object mapping resolves to invalid JSON (AF-M9-08)", async () => {
    await expect(
      execute(
        withResolve({
          nodeId: "node-1",
          data: { mappings: [{ key: "o", value: "{nope", type: "object" }] },
          userId: "user-1",
          context: {},
          step,
          publish,
        }),
      ),
    ).rejects.toEqual(
      new NonRetriableError(
        'Set node: "o" expects a object but resolved to "{nope", which is not valid JSON',
      ),
    );
  });

  it("throws when an object mapping resolves to a non-object (AF-M9-08)", async () => {
    await expect(
      execute(
        withResolve({
          nodeId: "node-1",
          data: { mappings: [{ key: "o", value: "[1,2]", type: "object" }] },
          userId: "user-1",
          context: {},
          step,
          publish,
        }),
      ),
    ).rejects.toEqual(
      new NonRetriableError(
        'Set node: "o" expects an object but resolved to a non-object value',
      ),
    );
  });

  it("throws when an array mapping resolves to a non-array (AF-M9-08)", async () => {
    await expect(
      execute(
        withResolve({
          nodeId: "node-1",
          data: { mappings: [{ key: "arr", value: '{"x":1}', type: "array" }] },
          userId: "user-1",
          context: {},
          step,
          publish,
        }),
      ),
    ).rejects.toEqual(
      new NonRetriableError(
        'Set node: "arr" expects an array but resolved to a non-array value',
      ),
    );
  });
});
