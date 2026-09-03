import { describe, expect, it } from "vitest";
import { nodeManifest } from "./manifest";
import {
  DEFAULT_INPUT,
  DEFAULT_OUTPUT,
  defaultInputId,
  defaultOutputId,
  handleOffset,
  inputPorts,
  normalizePortId,
  outputPorts,
  resolveEdgePorts,
} from "./ports";

/**
 * AF-M9-03. `PortDef.id` is the React Flow handle id and the persisted
 * `Connection.fromOutput`/`toInput`. These tests pin that one resolution path,
 * because before AF-M9-03 the canvas, the save boundary, and the engine each
 * had a different idea of what a port was called.
 */

describe("inputPorts / outputPorts", () => {
  it("returns the declared ports for a registered type", () => {
    expect(outputPorts("CONDITION").map((p) => p.id)).toEqual([
      "true",
      "false",
    ]);
    expect(inputPorts("CONDITION").map((p) => p.id)).toEqual(["main"]);
  });

  it("returns the empty input list a trigger declares, not a fallback", () => {
    // A trigger genuinely has no inputs; inventing one would render a target
    // handle that nothing may legally connect to.
    expect(inputPorts("MANUAL_TRIGGER")).toEqual([]);
    expect(outputPorts("MANUAL_TRIGGER").map((p) => p.id)).toEqual(["main"]);
  });

  it("falls back for an unregistered type so the node still connects", () => {
    expect(inputPorts("NOT_A_REAL_TYPE")).toEqual([DEFAULT_INPUT]);
    expect(outputPorts("NOT_A_REAL_TYPE")).toEqual([DEFAULT_OUTPUT]);
  });

  it("every manifest node declares at least one output", () => {
    // A node with no outputs is unreachable-through: the append affordance and
    // defaultOutputId would both have nothing to attach to.
    for (const def of nodeManifest) {
      expect(
        def.outputs.length,
        `${def.type} declares no outputs`,
      ).toBeGreaterThan(0);
    }
  });

  it("port ids are unique within a node", () => {
    for (const def of nodeManifest) {
      const outIds = def.outputs.map((p) => p.id);
      const inIds = def.inputs.map((p) => p.id);
      expect(new Set(outIds).size, `${def.type} outputs`).toBe(outIds.length);
      expect(new Set(inIds).size, `${def.type} inputs`).toBe(inIds.length);
    }
  });

  it("no manifest node uses a legacy handle id as a real port id", () => {
    // If one ever did, normalizePortId could not tell authored from legacy.
    for (const def of nodeManifest) {
      for (const p of [...def.inputs, ...def.outputs]) {
        expect(["source-1", "target-1"]).not.toContain(p.id);
      }
    }
  });
});

describe("defaultOutputId / defaultInputId", () => {
  it("is the first declared port, not the literal 'main'", () => {
    // CONDITION has no "main" output — appending from it must land on "true".
    expect(defaultOutputId("CONDITION")).toBe("true");
    expect(defaultOutputId("SET")).toBe("main");
    expect(defaultInputId("SET")).toBe("main");
  });

  it("falls back to 'main' for an unregistered type", () => {
    expect(defaultOutputId("NOT_A_REAL_TYPE")).toBe("main");
    expect(defaultInputId("NOT_A_REAL_TYPE")).toBe("main");
  });

  it("falls back to 'main' for a trigger's non-existent input", () => {
    expect(defaultInputId("MANUAL_TRIGGER")).toBe("main");
  });
});

describe("normalizePortId", () => {
  it("translates the legacy canvas handle ids to the first declared port", () => {
    expect(normalizePortId("CONDITION", "source-1", "source")).toBe("true");
    expect(normalizePortId("SET", "source-1", "source")).toBe("main");
    expect(normalizePortId("SET", "target-1", "target")).toBe("main");
  });

  it("leaves an already-declared port exactly as authored", () => {
    // The templates in the catalogue author sourceHandle: "false" by hand;
    // normalisation must never "helpfully" move them to the first port.
    expect(normalizePortId("CONDITION", "false", "source")).toBe("false");
    expect(normalizePortId("CONDITION", "true", "source")).toBe("true");
  });

  it("treats a missing handle as the default port", () => {
    expect(normalizePortId("SET", null, "source")).toBe("main");
    expect(normalizePortId("SET", undefined, "target")).toBe("main");
  });

  it("returns null for an id that is neither legacy nor declared", () => {
    // The migration reports these rather than guessing a rewire.
    expect(normalizePortId("CONDITION", "banana", "source")).toBeNull();
    expect(normalizePortId("SET", "source-2", "source")).toBeNull();
  });

  it("does not accept a target-side legacy id on the source side", () => {
    expect(normalizePortId("SET", "target-1", "source")).toBeNull();
    expect(normalizePortId("SET", "source-1", "target")).toBeNull();
  });
});

describe("resolveEdgePorts", () => {
  const types: Record<string, string> = {
    trig: "MANUAL_TRIGGER",
    cond: "CONDITION",
    set: "SET",
  };
  const typeOf = (id: string) => types[id];

  it("translates a legacy canvas edge onto real ports", () => {
    expect(
      resolveEdgePorts(
        {
          source: "cond",
          target: "set",
          sourceHandle: "source-1",
          targetHandle: "target-1",
        },
        typeOf,
      ),
    ).toEqual({ fromOutput: "true", toInput: "main" });
  });

  it("preserves an authored branch port", () => {
    expect(
      resolveEdgePorts(
        {
          source: "cond",
          target: "set",
          sourceHandle: "false",
          targetHandle: "main",
        },
        typeOf,
      ),
    ).toEqual({ fromOutput: "false", toInput: "main" });
  });

  it("defaults a handle-less edge to the first declared ports", () => {
    expect(resolveEdgePorts({ source: "trig", target: "set" }, typeOf)).toEqual(
      { fromOutput: "main", toInput: "main" },
    );
  });

  it("passes an unrecognised handle through so validate() can report it", () => {
    // Silently rewiring it would move the user's edge to a branch they did not
    // choose, and the run would then take the wrong path with no error.
    expect(
      resolveEdgePorts(
        { source: "cond", target: "set", sourceHandle: "banana" },
        typeOf,
      ).fromOutput,
    ).toBe("banana");
  });

  it("falls back to 'main' when the node type is unknown", () => {
    expect(
      resolveEdgePorts({ source: "ghost", target: "set" }, () => undefined),
    ).toEqual({ fromOutput: "main", toInput: "main" });
  });
});

describe("handleOffset", () => {
  it("centres a single handle, matching the pre-AF-M9-03 look", () => {
    expect(handleOffset(0, 1)).toBe("50%");
    expect(handleOffset(0, 0)).toBe("50%");
  });

  it("spaces N handles evenly and symmetrically", () => {
    expect(handleOffset(0, 2)).toBe(`${(1 / 3) * 100}%`);
    expect(handleOffset(1, 2)).toBe(`${(2 / 3) * 100}%`);
    expect(handleOffset(0, 3)).toBe("25%");
    expect(handleOffset(1, 3)).toBe("50%");
    expect(handleOffset(2, 3)).toBe("75%");
  });
});
