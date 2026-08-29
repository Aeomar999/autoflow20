import { describe, expect, it } from "vitest";
import { z } from "zod";
import { type Graph, type ValidationRegistry, validate } from "./validate";

/**
 * AF-M2-02 unit tests for the shared graph validator.
 *
 * Test helpers build minimal graphs inline. No Prisma, no DB, no Inngest.
 */

function makeNode(
  id: string,
  type: string,
  name?: string,
  data: Record<string, unknown> = {},
) {
  return { id, type, name: name ?? id, data };
}

function makeEdge(
  from: string,
  to: string,
  fromOutput = "main",
  toInput = "main",
) {
  return { fromNodeId: from, toNodeId: to, fromOutput, toInput };
}

function errorsOf(result: ReturnType<typeof validate>) {
  return result.errors.filter((e) => e.severity === "error");
}

function warningsOf(result: ReturnType<typeof validate>) {
  return result.errors.filter((e) => e.severity === "warning");
}

// ---------------------------------------------------------------------------
// Graph topology tests
// ---------------------------------------------------------------------------

describe("validate — graph topology", () => {
  it("accepts a single trigger node", () => {
    const graph: Graph = {
      nodes: [makeNode("t1", "MANUAL_TRIGGER", "Start")],
      connections: [],
    };
    const result = validate(graph);
    expect(errorsOf(result)).toHaveLength(0);
    expect(result.order).toEqual(["t1"]);
  });

  it("accepts a linear two-node graph", () => {
    const graph: Graph = {
      nodes: [
        makeNode("t1", "MANUAL_TRIGGER", "Start"),
        makeNode("n1", "HTTP_REQUEST", "Fetch"),
      ],
      connections: [makeEdge("t1", "n1")],
    };
    const result = validate(graph);
    expect(errorsOf(result)).toHaveLength(0);
    expect(result.order).toEqual(["t1", "n1"]);
  });

  it("accepts a branching graph (condition → true/false)", () => {
    const graph: Graph = {
      nodes: [
        makeNode("t1", "MANUAL_TRIGGER", "Start"),
        makeNode("c1", "CONDITION", "Check"),
        makeNode("a1", "HTTP_REQUEST", "Yes"),
        makeNode("a2", "SLACK", "No"),
      ],
      connections: [
        makeEdge("t1", "c1"),
        makeEdge("c1", "a1", "true", "main"),
        makeEdge("c1", "a2", "false", "main"),
      ],
    };
    const result = validate(graph);
    expect(errorsOf(result)).toHaveLength(0);
    expect(result.order).toEqual(["t1", "c1", "a1", "a2"]);
  });

  it("accepts a diamond graph", () => {
    const graph: Graph = {
      nodes: [
        makeNode("t1", "MANUAL_TRIGGER", "Start"),
        makeNode("n1", "HTTP_REQUEST", "A"),
        makeNode("n2", "HTTP_REQUEST", "B"),
        makeNode("n3", "HTTP_REQUEST", "Merge"),
      ],
      connections: [
        makeEdge("t1", "n1"),
        makeEdge("t1", "n2"),
        makeEdge("n1", "n3"),
        makeEdge("n2", "n3"),
      ],
    };
    const result = validate(graph);
    expect(errorsOf(result)).toHaveLength(0);
    expect(result.order).toEqual(["t1", "n1", "n2", "n3"]);
  });

  it("detects a cycle", () => {
    const graph: Graph = {
      nodes: [
        makeNode("t1", "MANUAL_TRIGGER", "Start"),
        makeNode("n1", "HTTP_REQUEST", "A"),
        makeNode("n2", "HTTP_REQUEST", "B"),
      ],
      connections: [
        makeEdge("t1", "n1"),
        makeEdge("n1", "n2"),
        makeEdge("n2", "n1"),
      ],
    };
    const result = validate(graph);
    const cycleErrors = errorsOf(result).filter((e) =>
      e.message.includes("cycle"),
    );
    expect(cycleErrors).toHaveLength(1);
    expect(result.order).toEqual([]);
  });

  it("reports disconnected nodes as warnings", () => {
    const graph: Graph = {
      nodes: [
        makeNode("t1", "MANUAL_TRIGGER", "Start"),
        makeNode("n1", "HTTP_REQUEST", "Connected"),
        makeNode("n2", "HTTP_REQUEST", "Orphan"),
      ],
      connections: [makeEdge("t1", "n1")],
    };
    const result = validate(graph);
    expect(errorsOf(result)).toHaveLength(0);
    const warnings = warningsOf(result);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].nodeId).toBe("n2");
    expect(warnings[0].message).toContain("not reachable");
  });

  it("reports an empty graph as valid", () => {
    const graph: Graph = { nodes: [], connections: [] };
    const result = validate(graph);
    expect(errorsOf(result)).toHaveLength(0);
    expect(result.order).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Trigger checks
// ---------------------------------------------------------------------------

describe("validate — trigger checks", () => {
  it("errors when no trigger is present", () => {
    const graph: Graph = {
      nodes: [makeNode("n1", "HTTP_REQUEST", "Fetch")],
      connections: [],
    };
    const result = validate(graph);
    const triggerErrors = errorsOf(result).filter((e) =>
      e.message.includes("no trigger"),
    );
    expect(triggerErrors).toHaveLength(1);
  });

  it("errors when multiple triggers are present", () => {
    const graph: Graph = {
      nodes: [
        makeNode("t1", "MANUAL_TRIGGER", "Manual"),
        makeNode("t2", "STRIPE_TRIGGER", "Stripe"),
      ],
      connections: [],
    };
    const result = validate(graph);
    const triggerErrors = errorsOf(result).filter((e) =>
      e.message.includes("Multiple trigger"),
    );
    expect(triggerErrors).toHaveLength(2);
  });

  it("recognizes GOOGLE_FORM_TRIGGER as a trigger", () => {
    const graph: Graph = {
      nodes: [makeNode("t1", "GOOGLE_FORM_TRIGGER", "Form")],
      connections: [],
    };
    const result = validate(graph);
    const triggerErrors = errorsOf(result).filter((e) =>
      e.message.includes("trigger"),
    );
    expect(triggerErrors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Registry-dependent checks (simulated)
// ---------------------------------------------------------------------------

describe("validate — unknown types", () => {
  it("errors on unknown node type when registry is provided", () => {
    const graph: Graph = {
      nodes: [
        makeNode("t1", "MANUAL_TRIGGER", "Start"),
        makeNode("n1", "UNKNOWN_TYPE", "Bad"),
      ],
      connections: [makeEdge("t1", "n1")],
    };

    // Minimal mock registry that only knows MANUAL_TRIGGER.
    const registry = {
      has: (type: string) => type === "MANUAL_TRIGGER",
      resolve: (type: string) => {
        if (type === "MANUAL_TRIGGER") {
          return {
            type: "MANUAL_TRIGGER",
            version: 1,
            category: "TRIGGER",
            label: "Manual",
            description: "",
            icon: "",
            configSchema: { safeParse: () => ({ success: true }) },
            defaults: {},
            inputs: [],
            outputs: [],
          } as never;
        }
        throw new Error(`Unknown: ${type}`);
      },
      list: () => [],
    } as never;

    const result = validate(graph, registry);
    const typeErrors = errorsOf(result).filter((e) =>
      e.message.includes("Unknown node type"),
    );
    expect(typeErrors).toHaveLength(1);
    expect(typeErrors[0].nodeId).toBe("n1");
  });

  it("skips type checks when no registry is provided", () => {
    const graph: Graph = {
      nodes: [
        makeNode("t1", "MANUAL_TRIGGER", "Start"),
        makeNode("n1", "ANYTHING", "ok"),
      ],
      connections: [makeEdge("t1", "n1")],
    };
    const result = validate(graph);
    const typeErrors = errorsOf(result).filter((e) =>
      e.message.includes("Unknown node type"),
    );
    expect(typeErrors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Deterministic ordering
// ---------------------------------------------------------------------------

describe("validate — deterministic ordering", () => {
  it("produces the same order for identical graphs", () => {
    const graph: Graph = {
      nodes: [
        makeNode("z1", "HTTP_REQUEST", "Z"),
        makeNode("a1", "MANUAL_TRIGGER", "A"),
        makeNode("m1", "SLACK", "M"),
      ],
      connections: [makeEdge("a1", "z1"), makeEdge("z1", "m1")],
    };
    const order1 = validate(graph).order;
    const order2 = validate(graph).order;
    expect(order1).toEqual(order2);
  });

  it("sorts isolated nodes alphabetically by id", () => {
    const graph: Graph = {
      nodes: [
        makeNode("t1", "MANUAL_TRIGGER", "Start"),
        makeNode("c2", "HTTP_REQUEST", "B"),
        makeNode("a1", "HTTP_REQUEST", "A"),
      ],
      connections: [makeEdge("t1", "a1")],
    };
    const result = validate(graph);
    expect(result.order).toEqual(["t1", "a1", "c2"]);
  });
});

// ---------------------------------------------------------------------------
// Registry-backed config + input validation (AF-M1-07)
// ---------------------------------------------------------------------------

describe("validate — config validation with a real registry", () => {
  const registry: ValidationRegistry = {
    has: (type) => type === "MANUAL_TRIGGER" || type === "HTTP_REQUEST",
    resolve: (type) => {
      if (type === "MANUAL_TRIGGER") {
        return {
          configSchema: z.object({}),
          inputs: [],
        };
      }
      if (type === "HTTP_REQUEST") {
        return {
          configSchema: z.object({ endpoint: z.url().optional() }),
          inputs: [{ id: "main", required: true }],
        };
      }
      throw new Error(`Unknown node type: "${type}".`);
    },
  };

  it("flags an invalid config with a field path", () => {
    const graph: Graph = {
      nodes: [
        makeNode("t1", "MANUAL_TRIGGER", "Start"),
        makeNode("n1", "HTTP_REQUEST", "Fetch", { endpoint: 12345 }),
      ],
      connections: [makeEdge("t1", "n1")],
    };
    const result = validate(graph, registry);
    const configErrors = errorsOf(result).filter((e) =>
      e.message.startsWith("Config error:"),
    );
    expect(configErrors).toHaveLength(1);
    expect(configErrors[0].nodeId).toBe("n1");
    expect(configErrors[0].path).toBe("endpoint");
  });

  it("accepts a valid config", () => {
    const graph: Graph = {
      nodes: [
        makeNode("t1", "MANUAL_TRIGGER", "Start"),
        makeNode("n1", "HTTP_REQUEST", "Fetch", {
          endpoint: "https://example.com",
        }),
      ],
      connections: [makeEdge("t1", "n1")],
    };
    const result = validate(graph, registry);
    expect(errorsOf(result)).toHaveLength(0);
  });

  it("flags an unconnected required input with a main-port path", () => {
    const graph: Graph = {
      nodes: [
        makeNode("n1", "HTTP_REQUEST", "Fetch", {
          endpoint: "https://example.com",
        }),
      ],
      connections: [],
    };
    const result = validate(graph, registry);
    const inputErrors = errorsOf(result).filter((e) =>
      e.message.includes("input"),
    );
    expect(inputErrors).toHaveLength(1);
    expect(inputErrors[0].nodeId).toBe("n1");
    expect(inputErrors[0].path).toBe("inputs.main");
  });

  it("clears the required-input error once connected", () => {
    const graph: Graph = {
      nodes: [
        makeNode("t1", "MANUAL_TRIGGER", "Start"),
        makeNode("n1", "HTTP_REQUEST", "Fetch", {
          endpoint: "https://example.com",
        }),
      ],
      connections: [makeEdge("t1", "n1")],
    };
    const result = validate(graph, registry);
    const inputErrors = errorsOf(result).filter((e) =>
      e.message.includes("input"),
    );
    expect(inputErrors).toHaveLength(0);
  });
});
