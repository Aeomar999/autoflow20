import { describe, expect, it } from "vitest";
import { defaultInputId } from "@/nodes/ports";
import {
  byInputKey,
  configSchema,
  definition,
  type MergeData,
  resolveInputs,
} from "./definition";

describe("MERGE definition", () => {
  it("exports a valid NodeDefinition (v2)", () => {
    expect(definition).toEqual(
      expect.objectContaining({
        type: "MERGE",
        version: 2,
        category: "LOGIC",
      }),
    );
  });

  it("accepts a valid append config", () => {
    expect(configSchema.safeParse({ mode: "append" }).success).toBe(true);
  });

  it("accepts a valid combine config (v1 legacy)", () => {
    expect(
      configSchema.safeParse({ mode: "combine", combineKey: "myData" }).success,
    ).toBe(true);
  });

  it("accepts empty config (defaults apply)", () => {
    expect(configSchema.safeParse({}).success).toBe(true);
  });

  it("rejects unknown mode", () => {
    expect(configSchema.safeParse({ mode: "zip" }).success).toBe(false);
  });

  it("rejects an inputCount outside 2–5", () => {
    expect(configSchema.safeParse({ inputCount: 1 }).success).toBe(false);
    expect(configSchema.safeParse({ inputCount: 6 }).success).toBe(false);
  });

  it("accepts the default byInput mode with an inputCount", () => {
    expect(
      configSchema.safeParse({ mode: "byInput", inputCount: 3 }).success,
    ).toBe(true);
  });
});

describe("MERGE resolveInputs (AF-M9-11)", () => {
  it("emits input-0…input-n for the configured count", () => {
    expect(resolveInputs({ inputCount: 3 }).map((p) => p.id)).toEqual([
      "input-0",
      "input-1",
      "input-2",
    ]);
  });

  it("defaults to 2 ports", () => {
    expect(resolveInputs(undefined).map((p) => p.id)).toEqual([
      "input-0",
      "input-1",
    ]);
  });

  it("drives the shared input port resolution path (render + save)", () => {
    expect(resolveInputs({ inputCount: 4 }).map((p) => p.id)).toEqual([
      "input-0",
      "input-1",
      "input-2",
      "input-3",
    ]);
    // defaultInputId pins a handle-less edge onto the first declared port.
    expect(defaultInputId("MERGE", { inputCount: 3 })).toBe("input-0");
  });
});

describe("MERGE byInputKey (AF-M9-11)", () => {
  it("drops the dash for the W2 output key", () => {
    expect(byInputKey("input-0")).toBe("input0");
    expect(byInputKey("input-1")).toBe("input1");
  });
});

describe("MERGE migrate (v1 → v2)", () => {
  it("backfills mode and inputCount for a legacy v1 node", () => {
    const migrated = definition.migrate?.(
      { mode: "combine", combineKey: "data" },
      1,
    );
    expect(migrated).toEqual({
      mode: "combine",
      combineKey: "data",
      inputCount: 2,
    });
  });

  it("defaults an unset v1 mode to append, not the v2 byInput", () => {
    const migrated = definition.migrate?.({}, 1) as MergeData | undefined;
    expect(migrated?.mode).toBe("append");
    expect(migrated?.inputCount).toBe(2);
  });

  it("leaves a v2 config untouched", () => {
    const migrated = definition.migrate?.(
      { mode: "byInput", inputCount: 4 },
      2,
    ) as MergeData | undefined;
    expect(migrated).toEqual({ mode: "byInput", inputCount: 4 });
  });
});
